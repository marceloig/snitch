import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type StoreTokenInput = {
  requestId: string;
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  durationSeconds: number;
  taskToken: string;
  startTime?: string | null;
};

/**
 * Invoked by the WaitForApproval Step Functions state via the waitForTaskToken
 * integration pattern. Stores the task token in DynamoDB and sets the request
 * status to PENDING_APPROVAL so the UI can display it.
 *
 * The state machine remains paused until SendTaskSuccess or SendTaskFailure
 * is called by approveRequestHandler or rejectRequestHandler.
 */
export const handler = async (input: StoreTokenInput): Promise<void> => {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: input.requestId },
      UpdateExpression: "SET #s = :s, taskToken = :token, updatedAt = :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "PENDING_APPROVAL",
        ":token": input.taskToken,
        ":now": new Date().toISOString(),
      },
    })
  );
};
