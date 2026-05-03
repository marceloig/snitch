import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;
const PRIVILEGED_POLICY_TABLE_NAME = process.env.PRIVILEGED_POLICY_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type AppSyncIdentity = {
  username: string;
  claims: Record<string, unknown>;
};

type AppSyncEvent = { arguments: Record<string, never>; identity: AppSyncIdentity };

/**
 * AppSync query resolver that returns PENDING_APPROVAL access requests the
 * calling admin is authorized to approve or reject.
 *
 * Authorization is determined by the PrivilegedPolicy records: the caller's
 * Cognito username must be in `approverUsernames` OR one of their Cognito
 * groups must be in `approverGroupNames` for the policy that covers the request.
 */
export const handler = async (event: AppSyncEvent) => {
  const callerUsername = event.identity.username;
  const callerGroups = (event.identity.claims["cognito:groups"] as string[]) ?? [];

  // Collect all (accountId, permissionSetArn) pairs for which the caller is an approver
  const policyScan = await dynamo.send(
    new ScanCommand({ TableName: PRIVILEGED_POLICY_TABLE_NAME })
  );

  const approvablePairs = new Set<string>();
  for (const policy of policyScan.Items ?? []) {
    if (!policy.requiresApproval) continue;
    const approverUsernames: string[] = policy.approverUsernames ?? [];
    const approverGroupNames: string[] = policy.approverGroupNames ?? [];
    const isApprover =
      approverUsernames.includes(callerUsername) ||
      callerGroups.some((g) => approverGroupNames.includes(g));
    if (!isApprover) continue;
    for (const accountId of policy.accountIds ?? []) {
      for (const psArn of policy.permissionSetArns ?? []) {
        approvablePairs.add(`${accountId}::${psArn}`);
      }
    }
  }

  if (approvablePairs.size === 0) return [];

  const requestScan = await dynamo.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "PENDING_APPROVAL" },
    })
  );

  return (requestScan.Items ?? []).filter((r) =>
    approvablePairs.has(`${r.accountId}::${r.permissionSetArn}`)
  );
};
