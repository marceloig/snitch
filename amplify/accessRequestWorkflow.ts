import { Stack, RemovalPolicy } from "aws-cdk-lib";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction, IFunction } from "aws-cdk-lib/aws-lambda";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";

interface AccessRequestResources {
  assignPermissionSetFunction: { resources: { lambda: IFunction } };
  removePermissionSetFunction: { resources: { lambda: IFunction } };
  setStatusFailedFunction: { resources: { lambda: IFunction } };
  requestAccessFunction: { resources: { lambda: IFunction } };
  listAccessRequestsFunction: { resources: { lambda: IFunction } };
}

export function setupAccessRequestWorkflow(backend: AccessRequestResources): void {
  const assignLambda = backend.assignPermissionSetFunction.resources.lambda as LambdaFunction;
  const removeLambda = backend.removePermissionSetFunction.resources.lambda as LambdaFunction;
  const setFailedLambda = backend.setStatusFailedFunction.resources.lambda as LambdaFunction;
  const requestLambda = backend.requestAccessFunction.resources.lambda as LambdaFunction;
  const listLambda = backend.listAccessRequestsFunction.resources.lambda as LambdaFunction;

  // Retrieve the shared workflow stack from the Lambda construct itself.
  // This is the same NestedStack Amplify created for resourceGroupName:
  // "AccessRequestWorkflow" — no new stack, no duplicate logical ID.
  const workflowStack = Stack.of(assignLambda);

  const accessRequestTable = new Table(workflowStack, "AccessRequestTable", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    removalPolicy: RemovalPolicy.RETAIN,
  });

  // GSI so listAccessRequestsHandler can query by idcUserId efficiently
  accessRequestTable.addGlobalSecondaryIndex({
    indexName: "byIdcUserId",
    partitionKey: { name: "idcUserId", type: AttributeType.STRING },
  });

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

  const stateMachineRole = new Role(workflowStack, "StateMachineRole", {
    assumedBy: new ServicePrincipal("states.amazonaws.com"),
    inlinePolicies: {
      InvokeLambdas: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["lambda:InvokeFunction"],
            resources: [assignLambda.functionArn, removeLambda.functionArn, setFailedLambda.functionArn],
          }),
        ],
      }),
    },
  });

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
    Comment: "Assigns a permission set to an IDC user, waits, then removes it.",
    StartAt: "AssignPermissionSet",
    States: {
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

  for (const fn of [assignLambda, removeLambda]) {
    fn.addToRolePolicy(accessRequestDdbPolicy);
    fn.addToRolePolicy(ssoAssignmentPolicy);
    fn.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);
  }

  setFailedLambda.addToRolePolicy(accessRequestDdbPolicy);
  setFailedLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);

  requestLambda.addToRolePolicy(accessRequestDdbPolicy);
  requestLambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["states:StartExecution"],
      resources: [cfnStateMachine.attrArn],
    })
  );
  requestLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);
  requestLambda.addEnvironment(
    "ACCESS_REQUEST_STATE_MACHINE_ARN",
    cfnStateMachine.attrArn
  );

  listLambda.addToRolePolicy(accessRequestDdbPolicy);
  listLambda.addEnvironment("ACCESS_REQUEST_TABLE_NAME", accessRequestTable.tableName);
}
