import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDynamoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {},
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { handler } = await import(
  "../../amplify/functions/accessRequests/storeActiveTokenHandler"
);

const BASE_INPUT = {
  requestId: "req-1",
  idcUserId: "user-abc",
  accountId: "111111111111",
  permissionSetArn: "arn:aws:sso:::permissionSet/ssoins-1/ps-read",
  durationSeconds: 3600,
  taskToken: "token-xyz",
};

describe("storeActiveTokenHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_REQUEST_TABLE_NAME = "AccessRequestTable";
    mockDynamoSend.mockResolvedValue({});
  });

  it("stores the task token in DynamoDB", async () => {
    await handler(BASE_INPUT);

    expect(mockDynamoSend).toHaveBeenCalledOnce();
    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: BASE_INPUT.requestId });
    expect(cmd.input.ExpressionAttributeValues[":token"]).toBe(BASE_INPUT.taskToken);
  });

  it("sets updatedAt on the record", async () => {
    const before = new Date().toISOString();
    await handler(BASE_INPUT);
    const after = new Date().toISOString();

    const cmd = mockDynamoSend.mock.calls[0][0];
    const updatedAt = cmd.input.ExpressionAttributeValues[":now"];
    expect(updatedAt >= before).toBe(true);
    expect(updatedAt <= after).toBe(true);
  });

  it("does not change the status field (request stays ACTIVE)", async () => {
    await handler(BASE_INPUT);

    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).not.toContain("#s");
    expect(cmd.input.ExpressionAttributeValues).not.toHaveProperty(":s");
  });

  it("propagates DynamoDB errors", async () => {
    mockDynamoSend.mockRejectedValue(new Error("DynamoDB unavailable"));
    await expect(handler(BASE_INPUT)).rejects.toThrow("DynamoDB unavailable");
  });
});
