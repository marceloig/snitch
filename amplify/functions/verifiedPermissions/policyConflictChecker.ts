import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Throws if any existing policy already covers the same (principalId, accountId/ouId)
 * combination. One policy per principal-resource pair is enforced here so that
 * permission sets are always consolidated into a single policy rather than scattered.
 *
 * Example: user "abc" → account "123" already exists in policy "Prod Access".
 * Adding another policy for "abc" → "123" (even with a different permission set) is rejected.
 * The admin must edit "Prod Access" instead.
 */
export async function assertNoDuplicatePrincipalResource(
  dynamo: DynamoDBDocumentClient,
  tableName: string,
  {
    principalId,
    accountIds,
    ouIds,
    excludeId,
  }: {
    principalId: string;
    accountIds: string[];
    ouIds: string[];
    excludeId?: string;
  }
): Promise<void> {
  if (accountIds.length === 0 && ouIds.length === 0) return;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "principalId = :pid",
      ExpressionAttributeValues: { ":pid": principalId },
    })
  );

  for (const item of result.Items ?? []) {
    if (excludeId && item.id === excludeId) continue;

    const existingAccounts: string[] = item.accountIds ?? [];
    const existingOus: string[] = item.ouIds ?? [];

    const conflictingAccounts = accountIds.filter((id) => existingAccounts.includes(id));
    const conflictingOus = ouIds.filter((id) => existingOus.includes(id));

    if (conflictingAccounts.length > 0 || conflictingOus.length > 0) {
      const resources = [...conflictingAccounts, ...conflictingOus].join(", ");
      throw new Error(
        `Policy "${item.name}" already grants this principal access to: ${resources}. ` +
          `Edit the existing policy to add the new permission set instead.`
      );
    }
  }
}
