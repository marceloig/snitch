import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type AppSyncIdentityCognito = { sub: string; claims: Record<string, unknown> };
type AppSyncEvent = {
  arguments: { idcUserId: string };
  identity: AppSyncIdentityCognito;
};

export type AccessRequestRecord = {
  id: string;
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
  status: string;
  stepFunctionExecutionArn: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * AppSync resolver: returns all AccessRequest records for the given IDC user.
 * Uses a GSI on idcUserId so the query is efficient rather than a full scan.
 *
 * Example: query { listMyAccessRequests(idcUserId: "u1") { id status } }
 */
export const handler = async (
  event: AppSyncEvent
): Promise<AccessRequestRecord[]> => {
  const { idcUserId } = event.arguments;

  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "byIdcUserId",
      KeyConditionExpression: "idcUserId = :uid",
      ExpressionAttributeValues: { ":uid": idcUserId },
      ScanIndexForward: false, // newest first
    })
  );

  return (result.Items ?? []) as AccessRequestRecord[];
};
