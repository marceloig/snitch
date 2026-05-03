import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

type RevokeInput = { requestId: string };
type AppSyncEvent = { arguments: RevokeInput; identity: unknown };

/**
 * AppSync mutation resolver (Admins only) that signals the Step Function to
 * proceed immediately to RemovePermissionSet by sending SendTaskSuccess with
 * revokedByAdmin: true. RemovePermissionSet reads that flag and sets the final
 * DDB status to REVOKED instead of EXPIRED.
 *
 * The ConditionExpression on the token-clear update prevents double-send if two
 * admins click revoke simultaneously.
 */
export const handler = async (event: AppSyncEvent) => {
  const { requestId } = event.arguments;

  const getResult = await dynamo.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { id: requestId } })
  );
  if (!getResult.Item) {
    throw new Error(`Access request not found: ${requestId}`);
  }
  const request = getResult.Item;

  if (request.status !== "ACTIVE") {
    throw new Error(
      `Expected status ACTIVE, got: ${JSON.stringify(request.status)}`
    );
  }
  if (!request.taskToken) {
    throw new Error(
      `Expected a taskToken on request ${requestId}, but none was found`
    );
  }

  const token = request.taskToken as string;
  const now = new Date().toISOString();

  // Clear the token first to prevent concurrent revoke calls from double-sending
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: requestId },
      UpdateExpression: "SET taskToken = :null, updatedAt = :now",
      ConditionExpression: "#s = :active AND taskToken = :token",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":null": null,
        ":now": now,
        ":active": "ACTIVE",
        ":token": token,
      },
    })
  );

  // Signal WaitForEarlyRevocation to exit and proceed to RemovePermissionSet
  await sfn.send(
    new SendTaskSuccessCommand({
      taskToken: token,
      output: JSON.stringify({
        requestId,
        idcUserId: request.idcUserId,
        accountId: request.accountId,
        permissionSetArn: request.permissionSetArn,
        durationSeconds: (request.durationMinutes as number) * 60,
        revokedByAdmin: true,
      }),
    })
  );

  return {
    ...request,
    status: "REVOKED",
    taskToken: null,
    updatedAt: now,
  };
};
