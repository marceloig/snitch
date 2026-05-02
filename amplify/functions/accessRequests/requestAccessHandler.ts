import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE_NAME = process.env.ACCESS_REQUEST_TABLE_NAME!;
const STATE_MACHINE_ARN = process.env.ACCESS_REQUEST_STATE_MACHINE_ARN!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

type RequestAccessInput = {
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
};

type AppSyncEvent = { arguments: RequestAccessInput };

export type AccessRequest = {
  id: string;
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
  status: "PENDING" | "ACTIVE" | "EXPIRED" | "FAILED";
  stepFunctionExecutionArn: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * AppSync resolver: persists an AccessRequest record and starts the Step
 * Function execution that will assign the permission set, wait, then remove it.
 *
 * Example: mutation { requestAccess(idcUserId: "u1", accountId: "123", ...) { id status } }
 */
export const handler = async (event: AppSyncEvent): Promise<AccessRequest> => {
  const args = event.arguments;

  if (args.durationMinutes <= 0) {
    throw new Error(
      `Expected durationMinutes to be a positive number, got: ${JSON.stringify(args.durationMinutes)}`
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Persist the request as PENDING before starting the execution so the record
  // always exists even if StartExecution fails.
  const item: AccessRequest = {
    id,
    idcUserId: args.idcUserId,
    accountId: args.accountId,
    permissionSetArn: args.permissionSetArn,
    permissionSetName: args.permissionSetName,
    durationMinutes: args.durationMinutes,
    status: "PENDING",
    stepFunctionExecutionArn: null,
    createdAt: now,
    updatedAt: now,
  };

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  // Start the Step Function — passes all fields needed by each state
  const execution = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: id, // use request ID as execution name for easy correlation
      input: JSON.stringify({
        requestId: id,
        idcUserId: args.idcUserId,
        accountId: args.accountId,
        permissionSetArn: args.permissionSetArn,
        durationSeconds: args.durationMinutes * 60,
      }),
    })
  );

  // Update the record with the execution ARN now that we have it
  const updatedItem: AccessRequest = {
    ...item,
    stepFunctionExecutionArn: execution.executionArn ?? null,
    updatedAt: new Date().toISOString(),
  };

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedItem }));

  return updatedItem;
};
