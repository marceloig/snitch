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
  idcUserEmail?: string | null;
  idcUserDisplayName?: string | null;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
  requiresApproval?: boolean | null;
  justification: string;
};

type AppSyncEvent = { arguments: RequestAccessInput };

export type AccessRequest = {
  id: string;
  idcUserId: string;
  idcUserEmail: string | null;
  idcUserDisplayName: string | null;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
  requiresApproval: boolean;
  justification: string;
  status: "PENDING" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "FAILED" | "REJECTED";
  taskToken: string | null;
  approvedBy: string | null;
  approverComment: string | null;
  stepFunctionExecutionArn: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * AppSync resolver: persists an AccessRequest record and starts the Step
 * Function execution. If the matching PrivilegedPolicy requires approval the
 * initial status is PENDING_APPROVAL and the state machine will pause at the
 * WaitForApproval state; otherwise it is PENDING and proceeds immediately.
 */
export const handler = async (event: AppSyncEvent): Promise<AccessRequest> => {
  const args = event.arguments;

  if (args.durationMinutes <= 0) {
    throw new Error(
      `Expected durationMinutes to be a positive number, got: ${JSON.stringify(args.durationMinutes)}`
    );
  }

  // requiresApproval is determined by the frontend via evaluateMyAccess and
  // passed through the mutation. The AVP check already enforces who can request
  // what; approval is a workflow gate on top of that authorization.
  const requiresApproval = args.requiresApproval === true;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const item: AccessRequest = {
    id,
    idcUserId: args.idcUserId,
    idcUserEmail: args.idcUserEmail ?? null,
    idcUserDisplayName: args.idcUserDisplayName ?? null,
    accountId: args.accountId,
    permissionSetArn: args.permissionSetArn,
    permissionSetName: args.permissionSetName,
    durationMinutes: args.durationMinutes,
    requiresApproval,
    justification: args.justification,
    status: requiresApproval ? "PENDING_APPROVAL" : "PENDING",
    taskToken: null,
    approvedBy: null,
    approverComment: null,
    stepFunctionExecutionArn: null,
    createdAt: now,
    updatedAt: now,
  };

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  const execution = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: id,
      input: JSON.stringify({
        requestId: id,
        idcUserId: args.idcUserId,
        accountId: args.accountId,
        permissionSetArn: args.permissionSetArn,
        durationSeconds: args.durationMinutes * 60,
        requiresApproval,
      }),
    })
  );

  const updatedItem: AccessRequest = {
    ...item,
    stepFunctionExecutionArn: execution.executionArn ?? null,
    updatedAt: new Date().toISOString(),
  };

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedItem }));

  return updatedItem;
};

