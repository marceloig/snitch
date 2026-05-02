import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  VerifiedPermissionsClient,
  IsAuthorizedCommand,
} from "@aws-sdk/client-verifiedpermissions";
import {
  getIDCInstancePublic,
  listGroupMembershipsForUser,
} from "../awsResources/helpers";

const REGION = process.env.AWS_REGION ?? "us-east-2";
const TABLE_NAME = process.env.PRIVILEGED_POLICY_TABLE_NAME!;
const POLICY_STORE_ID = process.env.AVP_POLICY_STORE_ID!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const avp = new VerifiedPermissionsClient({ region: REGION });

type EvaluateInput = { idcUserId: string };
type AppSyncEvent = { arguments: EvaluateInput };

export type PermittedAccess = {
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
};

/**
 * For the given IDC user, evaluates every (account, permissionSet) combination
 * found across all PrivilegedPolicy records against AVP IsAuthorized.
 *
 * Group memberships are fetched and included as entities so Cedar policies
 * with `principal in Snitch::Group::` are evaluated correctly.
 *
 * Returns only the (account, permissionSet) pairs where AVP returns ALLOW.
 *
 * Example: mutation { evaluateMyAccess(idcUserId: "abc-123") { accountId permissionSetArn } }
 */
export const handler = async (event: AppSyncEvent): Promise<PermittedAccess[]> => {
  const { idcUserId } = event.arguments;

  // Fetch group memberships so group-based Cedar policies resolve correctly
  const { identityStoreId } = await getIDCInstancePublic();
  const groupIds = await listGroupMembershipsForUser(identityStoreId, idcUserId);

  // Build the entity list: the user entity with group memberships
  const userEntity = {
    identifier: { entityType: "Snitch::User", entityId: idcUserId },
    attributes: {},
    parents: groupIds.map((gid) => ({
      entityType: "Snitch::Group",
      entityId: gid,
    })),
  };

  // Scan all policies to collect every unique (accountId, permissionSetArn) pair
  // across the whole table. We evaluate each combination once against AVP.
  const scanResult = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
  const policies = scanResult.Items ?? [];

  type Candidate = { accountId: string; permissionSetArn: string; permissionSetName: string };
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const policy of policies) {
    const accountIds: string[] = policy.accountIds ?? [];
    const permissionSetArns: string[] = policy.permissionSetArns ?? [];
    const permissionSetNames: string[] = policy.permissionSetNames ?? [];

    for (const accountId of accountIds) {
      for (let i = 0; i < permissionSetArns.length; i++) {
        const arn = permissionSetArns[i];
        const key = `${accountId}::${arn}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({
            accountId,
            permissionSetArn: arn,
            permissionSetName: permissionSetNames[i] ?? arn,
          });
        }
      }
    }
  }

  // Evaluate each candidate in parallel against AVP
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const response = await avp.send(
        new IsAuthorizedCommand({
          policyStoreId: POLICY_STORE_ID,
          principal: { entityType: "Snitch::User", entityId: idcUserId },
          action: { actionType: "Snitch::Action", actionId: "assume" },
          resource: { entityType: "Snitch::Account", entityId: candidate.accountId },
          context: {
            contextMap: {
              permissionSetArn: { string: candidate.permissionSetArn },
            },
          },
          entities: {
            entityList: [userEntity],
          },
        })
      );

      return response.decision === "ALLOW" ? candidate : null;
    })
  );

  return results.filter((r): r is Candidate => r !== null);
};
