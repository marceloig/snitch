import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, SendTaskFailureCommand } from "@aws-sdk/client-sfn";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;
const PRIVILEGED_POLICY_TABLE_NAME = process.env.PRIVILEGED_POLICY_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

type RejectInput = { requestId: string; approverComment?: string | null };

type AppSyncIdentity = {
  username: string;
  claims: Record<string, unknown>;
};

type AppSyncEvent = { arguments: RejectInput; identity: AppSyncIdentity };

/**
 * AppSync mutation resolver for rejecting an access request.
 * Updates DynamoDB to REJECTED atomically (including approvedBy, approverComment,
 * and taskToken=null) BEFORE calling SendTaskFailure. This ensures the record is
 * in a consistent terminal state even if SendTaskFailure fails transiently.
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

  // Write REJECTED + all approval fields atomically before SendTaskFailure,
  // so the record is in a final consistent state regardless of SFN outcome.
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: requestId },
      UpdateExpression:
        "SET #s = :s, approvedBy = :by, approverComment = :comment, taskToken = :null, updatedAt = :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "REJECTED",
        ":by": approverUsername,
        ":comment": approverComment ?? null,
        ":null": null,
        ":now": now,
      },
    })
  );

  // Notify the Step Function to stop waiting — triggers the RejectionHandled Pass state
  await sfn.send(
    new SendTaskFailureCommand({
      taskToken: request.taskToken,
      error: "RequestRejected",
      cause: approverComment ?? "Request rejected by approver",
    })
  );

  return {
    ...request,
    status: "REJECTED",
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
    throw new Error(`You are not authorized to reject this request`);
  }
}
