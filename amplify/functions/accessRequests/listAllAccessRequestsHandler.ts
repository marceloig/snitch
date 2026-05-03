import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

type AppSyncEvent = { arguments: Record<string, never>; identity: unknown };

/**
 * AppSync query resolver (Admins only) that returns every access request across
 * all users, sorted newest-first by createdAt.
 */
export const handler = async (_event: AppSyncEvent) => {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
  return (result.Items ?? []).sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );
};
