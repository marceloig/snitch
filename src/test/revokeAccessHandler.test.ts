import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDynamoSend, mockSfnSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
  mockSfnSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {},
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  SendTaskSuccessCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { handler } = await import(
  "../../amplify/functions/accessRequests/revokeAccessHandler"
);

const ACTIVE_REQUEST = {
  id: "req-1",
  idcUserId: "user-abc",
  accountId: "111111111111",
  permissionSetArn: "arn:aws:sso:::permissionSet/ssoins-1/ps-read",
  permissionSetName: "ReadOnly",
  durationMinutes: 60,
  status: "ACTIVE",
  taskToken: "token-xyz",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const APPSYNC_EVENT = {
  arguments: { requestId: "req-1" },
  identity: { username: "admin-user" },
};

describe("revokeAccessHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_REQUEST_TABLE_NAME = "AccessRequestTable";
    mockSfnSend.mockResolvedValue({});
  });

  describe("validation", () => {
    it("throws when the request does not exist", async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
      await expect(handler(APPSYNC_EVENT)).rejects.toThrow("Access request not found: req-1");
    });

    it("throws when status is not ACTIVE", async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { ...ACTIVE_REQUEST, status: "EXPIRED" },
      });
      await expect(handler(APPSYNC_EVENT)).rejects.toThrow(
        'Expected status ACTIVE, got: "EXPIRED"'
      );
    });

    it("throws when taskToken is missing", async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { ...ACTIVE_REQUEST, taskToken: null },
      });
      await expect(handler(APPSYNC_EVENT)).rejects.toThrow(
        "Expected a taskToken on request req-1"
      );
    });
  });

  describe("successful revocation", () => {
    beforeEach(() => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: ACTIVE_REQUEST }) // GetCommand
        .mockResolvedValueOnce({});                      // UpdateCommand (clear token)
    });

    it("clears the task token in DynamoDB before sending SendTaskSuccess", async () => {
      await handler(APPSYNC_EVENT);

      const updateCmd = mockDynamoSend.mock.calls[1][0];
      expect(updateCmd.input.Key).toEqual({ id: "req-1" });
      expect(updateCmd.input.ExpressionAttributeValues[":null"]).toBeNull();
    });

    it("uses a ConditionExpression to prevent concurrent double-send", async () => {
      await handler(APPSYNC_EVENT);

      const updateCmd = mockDynamoSend.mock.calls[1][0];
      expect(updateCmd.input.ConditionExpression).toBeDefined();
      expect(updateCmd.input.ConditionExpression).toContain("taskToken");
    });

    it("sends SendTaskSuccess with revokedByAdmin: true", async () => {
      await handler(APPSYNC_EVENT);

      expect(mockSfnSend).toHaveBeenCalledOnce();
      const sfnCmd = mockSfnSend.mock.calls[0][0];
      expect(sfnCmd.input.taskToken).toBe(ACTIVE_REQUEST.taskToken);

      const output = JSON.parse(sfnCmd.input.output);
      expect(output.requestId).toBe("req-1");
      expect(output.revokedByAdmin).toBe(true);
      expect(output.durationSeconds).toBe(ACTIVE_REQUEST.durationMinutes * 60);
    });

    it("returns the item with optimistic REVOKED status", async () => {
      const result = await handler(APPSYNC_EVENT);
      expect(result.status).toBe("REVOKED");
      expect(result.taskToken).toBeNull();
    });
  });

  it("propagates DynamoDB errors on GetCommand", async () => {
    mockDynamoSend.mockRejectedValue(new Error("DynamoDB unavailable"));
    await expect(handler(APPSYNC_EVENT)).rejects.toThrow("DynamoDB unavailable");
  });

  it("propagates SFN errors", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: ACTIVE_REQUEST })
      .mockResolvedValueOnce({});
    mockSfnSend.mockRejectedValue(new Error("Step Functions unavailable"));

    await expect(handler(APPSYNC_EVENT)).rejects.toThrow("Step Functions unavailable");
  });
});
