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
  "../../amplify/functions/accessRequests/setStatusFailedHandler"
);

const BASE_INPUT = {
  requestId: "req-1",
  idcUserId: "user-abc",
  accountId: "111111111111",
  permissionSetArn: "arn:aws:sso:::permissionSet/ssoins-1/ps-read",
  durationSeconds: 3600,
};

describe("setStatusFailedHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_REQUEST_TABLE_NAME = "AccessRequestTable";
    mockDynamoSend.mockResolvedValue({});
  });

  it("updates DynamoDB status to FAILED", async () => {
    await handler(BASE_INPUT);

    expect(mockDynamoSend).toHaveBeenCalledOnce();
    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: BASE_INPUT.requestId });
    expect(cmd.input.ExpressionAttributeValues[":s"]).toBe("FAILED");
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

  it("works when error context is included (as Step Function Catch passes it)", async () => {
    const inputWithError = {
      ...BASE_INPUT,
      error: { Error: "Lambda.AWSLambdaException", Cause: "SSO unavailable" },
    };

    await handler(inputWithError);

    expect(mockDynamoSend).toHaveBeenCalledOnce();
    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: BASE_INPUT.requestId });
    expect(cmd.input.ExpressionAttributeValues[":s"]).toBe("FAILED");
  });

  it("propagates DynamoDB errors", async () => {
    mockDynamoSend.mockRejectedValue(new Error("DynamoDB unavailable"));
    await expect(handler(BASE_INPUT)).rejects.toThrow("DynamoDB unavailable");
  });
});
