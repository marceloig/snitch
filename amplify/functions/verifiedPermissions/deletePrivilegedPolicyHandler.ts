import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  VerifiedPermissionsClient,
  DeletePolicyCommand,
} from "@aws-sdk/client-verifiedpermissions";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.PRIVILEGED_POLICY_TABLE_NAME!;
const POLICY_STORE_ID = process.env.AVP_POLICY_STORE_ID!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const avp = new VerifiedPermissionsClient({ region: REGION });

type DeleteInput = { id: string };
type AppSyncEvent = { arguments: DeleteInput };

export const handler = async (event: AppSyncEvent) => {
  const { id } = event.arguments;

  // Step 1: Read current item to get avpPolicyId and snapshot for rollback
  const existing = await dynamo.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { id } })
  );
  if (!existing.Item) throw new Error(`PrivilegedPolicy not found: ${id}`);
  const snapshot = existing.Item;

  // Step 2: Delete from DynamoDB first
  await dynamo.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));

  // Step 3: Delete from AVP. Rollback DynamoDB if this fails.
  const avpPolicyId: string | undefined = snapshot.avpPolicyId;
  if (avpPolicyId) {
    try {
      await avp.send(
        new DeletePolicyCommand({ policyStoreId: POLICY_STORE_ID, policyId: avpPolicyId })
      );
    } catch (err) {
      // Rollback: restore DynamoDB item
      await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: snapshot }));
      throw err;
    }
  }

  return true;
};
