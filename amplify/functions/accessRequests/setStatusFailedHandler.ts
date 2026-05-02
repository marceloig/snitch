import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type FailInput = {
  requestId: string;
  error?: { Error: string; Cause: string };
};

/**
 * Step Function error handler: marks the AccessRequest as FAILED in DynamoDB.
 * Invoked via a Catch block on both AssignPermissionSet and RemovePermissionSet
 * states so that any failure is reflected in the record instead of leaving it
 * stuck in PENDING or ACTIVE.
 */
export const handler = async (input: FailInput): Promise<void> => {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: input.requestId },
      UpdateExpression: "SET #s = :s, updatedAt = :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "FAILED",
        ":now": new Date().toISOString(),
      },
    })
  );
};
