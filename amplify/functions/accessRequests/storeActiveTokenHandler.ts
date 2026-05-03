import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type StoreActiveTokenInput = {
  requestId: string;
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  durationSeconds: number;
  taskToken: string;
};

/**
 * Invoked by the WaitForEarlyRevocation Step Functions state via the
 * waitForTaskToken integration pattern. Stores the task token in DynamoDB so
 * revokeAccessHandler can call SendTaskSuccess to signal early revocation.
 *
 * The state machine remains paused until SendTaskSuccess is called (admin revoke)
 * or TimeoutSecondsPath elapses (natural expiry → States.Timeout catch).
 * Status is NOT changed here; the request is already ACTIVE from assignPermissionSetHandler.
 */
export const handler = async (input: StoreActiveTokenInput): Promise<void> => {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: input.requestId },
      UpdateExpression: "SET taskToken = :token, updatedAt = :now",
      ExpressionAttributeValues: {
        ":token": input.taskToken,
        ":now": new Date().toISOString(),
      },
    })
  );
};
