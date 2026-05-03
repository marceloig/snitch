import { Stack, RemovalPolicy } from "aws-cdk-lib";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";

interface AccessRequestResources {
  assignPermissionSetFunction: { resources: { lambda: IFunction } };
  removePermissionSetFunction: { resources: { lambda: IFunction } };
  setStatusFailedFunction: { resources: { lambda: IFunction } };
  storeApprovalTokenFunction: { resources: { lambda: IFunction } };
  requestAccessFunction: { resources: { lambda: IFunction } };
  listAccessRequestsFunction: { resources: { lambda: IFunction } };
}

export type AccessRequestWorkflowOutputs = {
  accessRequestTableArn: string;
  accessRequestTableName: string;
};

// approveRequest, rejectRequest, listPendingApprovals are intentionally NOT
// in this interface — they live in the data stack so AppSync can reference
// them without creating a circular dependency with this workflow stack.
export function setupAccessRequestWorkflow(
  backend: AccessRequestResources
): AccessRequestWorkflowOutputs {
  const assignLambda = backend.assignPermissionSetFunction.resources.lambda as LambdaFunction;
  const removeLambda = backend.removePermissionSetFunction.resources.lambda as LambdaFunction;
  const setFailedLambda = backend.setStatusFailedFunction.resources.lambda as LambdaFunction;
  const storeTokenLambda = backend.storeApprovalTokenFunction.resources.lambda as LambdaFunction;
  const requestLambda = backend.requestAccessFunction.resources.lambda as LambdaFunction;
  const listLambda = backend.listAccessRequestsFunction.resources.lambda as LambdaFunction;

  const workflowStack = Stack.of(assignLambda);

  const accessRequestTable = new Table(workflowStack, "AccessRequestTable", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    removalPolicy: RemovalPolicy.RETAIN,
  });

  accessRequestTable.addGlobalSecondaryIndex({
    indexName: "byIdcUserIdCreatedAt",
    partitionKey: { name: "idcUserId", type: AttributeType.STRING },
    sortKey: { name: "createdAt", type: AttributeType.STRING },
  });

  // ─── IAM policies ──────────────────────────────────────────────────────────

  const accessRequestDdbPolicy = new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ],
    resources: [
      accessRequestTable.tableArn,
      `${accessRequestTable.tableArn}/index/*`,
    ],
  });

  const ssoAssignmentPolicy = new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "sso:ListInstances",
      "sso:CreateAccountAssignment",
      "sso:DeleteAccountAssignment",
      "sso:DescribeAccountAssignmentCreationStatus",
      "sso:DescribeAccountAssignmentDeletionStatus",
    ],
    resources: ["*"],
  });

  // ─── State machine role ────────────────────────────────────────────────────

  const stateMachineRole = new Role(workflowStack, "StateMachineRole", {
    assumedBy: new ServicePrincipal("states.amazonaws.com"),
    inlinePolicies: {
      InvokeLambdas: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["lambda:InvokeFunction"],
            resources: [
              assignLambda.functionArn,
              removeLambda.functionArn,
              setFailedLambda.functionArn,
              // WaitForApproval uses waitForTaskToken to invoke storeApprovalToken
              storeTokenLambda.functionArn,
            ],
          }),
        ],
      }),
      // SetStatusExpired state uses SDK integration to write directly to DynamoDB
      DirectDynamoDB: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["dynamodb:UpdateItem"],
            resources: [accessRequestTable.tableArn],
          }),
        ],
      }),
    },
  });

  // ─── Step Functions state machine (ASL) ───────────────────────────────────

  const transientRetry = [
    {
      ErrorEquals: [
        "Lambda.ServiceException",
        "Lambda.AWSLambdaException",
        "Lambda.SdkClientException",
        "Lambda.TooManyRequestsException",
      ],
      IntervalSeconds: 2,
      MaxAttempts: 3,
      BackoffRate: 2,
      JitterStrategy: "FULL",
    },
  ];

  const aslDefinition = {
    Comment:
      "Assigns a permission set to an IDC user, waits, then removes it. Supports an optional approval gate.",
    StartAt: "CheckApproval",
    States: {

      // ─── Approval gate ────────────────────────────────────────────────────
      CheckApproval: {
        Type: "Choice",
        Choices: [
          {
            Variable: "$.requiresApproval",
            BooleanEquals: true,
            Next: "WaitForApproval",
          },
        ],
        Default: "AssignPermissionSet",
      },

      // Invokes storeApprovalTokenHandler with the task token injected by SFN.
      // The state machine pauses here until SendTaskSuccess or SendTaskFailure
      // is called externally (by approveRequestHandler / rejectRequestHandler).
      WaitForApproval: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke.waitForTaskToken",
        Parameters: {
          FunctionName: storeTokenLambda.functionArn,
          Payload: {
            "requestId.$": "$.requestId",
            "idcUserId.$": "$.idcUserId",
            "accountId.$": "$.accountId",
            "permissionSetArn.$": "$.permissionSetArn",
            "durationSeconds.$": "$.durationSeconds",
            "taskToken.$": "$$.Task.Token",
          },
        },
        // OutputPath: "$" means the JSON object from SendTaskSuccess.output
        // flows directly to AssignPermissionSet as its payload.
        OutputPath: "$",
        // Heartbeat acts as the approval deadline: 24 hours.
        HeartbeatSeconds: 86400,
        Next: "AssignPermissionSet",
        Catch: [
          {
            // 24-hour heartbeat timeout — no approval received in time.
            // SetStatusExpired uses DDB SDK integration; no Lambda needed.
            ErrorEquals: ["States.HeartbeatTimeout"],
            Next: "SetStatusExpired",
            ResultPath: "$.error",
          },
          {
            // rejectRequestHandler already set status=REJECTED in DDB before
            // calling SendTaskFailure, so a Pass state is sufficient here.
            ErrorEquals: ["RequestRejected"],
            Next: "RejectionHandled",
            ResultPath: "$.error",
          },
          {
            ErrorEquals: ["States.ALL"],
            Next: "SetStatusFailed",
            ResultPath: "$.error",
          },
        ],
      },

      // DynamoDB SDK integration — no Lambda cold start needed for this simple
      // status update. $.requestId is available from the state machine context
      // (preserved in the Catch ResultPath assignment above).
      SetStatusExpired: {
        Type: "Task",
        Resource: "arn:aws:states:::aws-sdk:dynamodb:updateItem",
        Parameters: {
          TableName: accessRequestTable.tableName,
          Key: { id: { "S.$": "$.requestId" } },
          // REMOVE taskToken clears the stored token; SET updates the status
          UpdateExpression: "SET #s = :s, updatedAt = :now REMOVE taskToken",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": { S: "EXPIRED" },
            // $$.State.EnteredTime is the ISO-8601 entry time of this state
            ":now": { "S.$": "$$.State.EnteredTime" },
          },
        },
        End: true,
      },

      // DDB was already fully updated by rejectRequestHandler before it called
      // SendTaskFailure, so no further action is needed here.
      RejectionHandled: {
        Type: "Pass",
        End: true,
      },

      // ─── Permission assignment ─────────────────────────────────────────────
      AssignPermissionSet: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: assignLambda.functionArn,
          "Payload.$": "$",
        },
        OutputPath: "$.Payload",
        Retry: transientRetry,
        Next: "WaitForDuration",
        Catch: [
          {
            ErrorEquals: ["States.ALL"],
            Next: "SetStatusFailed",
            ResultPath: "$.error",
          },
        ],
      },

      WaitForDuration: {
        Type: "Wait",
        SecondsPath: "$.durationSeconds",
        Next: "RemovePermissionSet",
      },

      RemovePermissionSet: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: removeLambda.functionArn,
          "Payload.$": "$",
        },
        OutputPath: "$.Payload",
        Retry: transientRetry,
        End: true,
        Catch: [
          {
            ErrorEquals: ["States.ALL"],
            Next: "SetStatusFailed",
            ResultPath: "$.error",
          },
        ],
      },

      SetStatusFailed: {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: setFailedLambda.functionArn,
          "Payload.$": "$",
        },
        Retry: transientRetry,
        End: true,
      },
    },
  };

  const cfnStateMachine = new CfnStateMachine(workflowStack, "AccessRequestStateMachine", {
    roleArn: stateMachineRole.roleArn,
    definitionString: JSON.stringify(aslDefinition),
  });

  // ─── Grants and env vars per Lambda ───────────────────────────────────────

  for (const fn of [assignLambda, removeLambda]) {
    fn.addToRolePolicy(accessRequestDdbPolicy);
    fn.addToRolePolicy(ssoAssignmentPolicy);
    fn.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);
  }

  setFailedLambda.addToRolePolicy(accessRequestDdbPolicy);
  setFailedLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);

  storeTokenLambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["dynamodb:UpdateItem"],
      resources: [accessRequestTable.tableArn],
    })
  );
  storeTokenLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);

  requestLambda.addToRolePolicy(accessRequestDdbPolicy);
  requestLambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["states:StartExecution"],
      resources: [cfnStateMachine.attrArn],
    })
  );
  requestLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);
  requestLambda.addEnvironment("ACCESS_REQUEST_STATE_MACHINE_ARN", cfnStateMachine.attrArn);

  listLambda.addToRolePolicy(accessRequestDdbPolicy);
  listLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);

  return {
    accessRequestTableArn: accessRequestTable.tableArn,
    accessRequestTableName: accessRequestTable.tableName,
  };
}
