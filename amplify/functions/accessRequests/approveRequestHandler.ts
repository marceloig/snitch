import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;
const PRIVILEGED_POLICY_TABLE_NAME = process.env.PRIVILEGED_POLICY_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

type ApproveInput = { requestId: string; approverComment?: string | null };

type AppSyncIdentity = {
  username: string;
  claims: Record<string, unknown>;
};

type AppSyncEvent = { arguments: ApproveInput; identity: AppSyncIdentity };

/**
 * AppSync mutation resolver for approving an access request.
 * Validates the caller is a configured approver for the matching policy,
 * updates DynamoDB, and resumes the Step Function via SendTaskSuccess.
 *
 * The SendTaskSuccess output contains the fields AssignPermissionSet expects.
 */
export const handler = async (event: AppSyncEvent) => {
  const { requestId, approverComment } = event.arguments;
  const approverUsername = event.identity.username;
  const callerGroups = (event.identity.claims["cognito:groups"] as string[]) ?? [];

  const getResult = await dynamo.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { id: requestId } })
  );
  if (!getResult.Item) {
    throw new Error(`Access request not found: ${requestId}`);
  }
  const request = getResult.Item;

  if (request.status !== "PENDING_APPROVAL") {
    throw new Error(
      `Expected status PENDING_APPROVAL, got: ${JSON.stringify(request.status)}`
    );
  }
  if (!request.taskToken) {
    throw new Error(
      `Expected a taskToken on request ${requestId}, but none was found`
    );
  }

  await assertIsAuthorizedApprover(
    request.idcUserId,
    request.accountId,
    request.permissionSetArn,
    approverUsername,
    callerGroups
  );

  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: requestId },
      UpdateExpression:
        "SET approvedBy = :by, approverComment = :comment, taskToken = :null, updatedAt = :now",
      ExpressionAttributeValues: {
        ":by": approverUsername,
        ":comment": approverComment ?? null,
        ":null": null,
        ":now": now,
      },
    })
  );

  // Resume the Step Function — output flows into AssignPermissionSet as its payload
  await sfn.send(
    new SendTaskSuccessCommand({
      taskToken: request.taskToken,
      output: JSON.stringify({
        requestId,
        idcUserId: request.idcUserId,
        accountId: request.accountId,
        permissionSetArn: request.permissionSetArn,
        durationSeconds: (request.durationMinutes as number) * 60,
      }),
    })
  );

  return {
    ...request,
    approvedBy: approverUsername,
    approverComment: approverComment ?? null,
    taskToken: null,
    updatedAt: now,
  };
};

async function assertIsAuthorizedApprover(
  idcUserId: string,
  accountId: string,
  permissionSetArn: string,
  callerUsername: string,
  callerGroups: string[]
): Promise<void> {
  const scan = await dynamo.send(
    new ScanCommand({
      TableName: PRIVILEGED_POLICY_TABLE_NAME,
      FilterExpression: "principalId = :pid AND requiresApproval = :true",
      ExpressionAttributeValues: { ":pid": idcUserId, ":true": true },
    })
  );

  const matchingPolicy = (scan.Items ?? []).find(
    (p) =>
      (p.accountIds ?? []).includes(accountId) &&
      (p.permissionSetArns ?? []).includes(permissionSetArn)
  );

  if (!matchingPolicy) {
    throw new Error(
      `No policy with requiresApproval found for this request (idcUserId=${idcUserId})`
    );
  }

  const approverUsernames: string[] = matchingPolicy.approverUsernames ?? [];
  const approverGroupNames: string[] = matchingPolicy.approverGroupNames ?? [];
  const authorized =
    approverUsernames.includes(callerUsername) ||
    callerGroups.some((g) => approverGroupNames.includes(g));

  if (!authorized) {
    throw new Error(`You are not authorized to approve this request`);
  }
}
