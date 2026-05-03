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
  ScanCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { handler } = await import(
  "../../amplify/functions/accessRequests/listAllAccessRequestsHandler"
);

const APPSYNC_EVENT = { arguments: {}, identity: {} };

describe("listAllAccessRequestsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_REQUEST_TABLE_NAME = "AccessRequestTable";
  });

  it("returns all items sorted newest-first by createdAt", async () => {
    mockDynamoSend.mockResolvedValue({
      Items: [
        { id: "req-1", createdAt: "2024-01-01T10:00:00Z" },
        { id: "req-3", createdAt: "2024-01-03T10:00:00Z" },
        { id: "req-2", createdAt: "2024-01-02T10:00:00Z" },
      ],
    });

    const result = await handler(APPSYNC_EVENT);

    expect(result.map((r) => r.id)).toEqual(["req-3", "req-2", "req-1"]);
  });

  it("returns an empty array when the table is empty", async () => {
    mockDynamoSend.mockResolvedValue({ Items: [] });
    const result = await handler(APPSYNC_EVENT);
    expect(result).toEqual([]);
  });

  it("handles undefined Items gracefully", async () => {
    mockDynamoSend.mockResolvedValue({});
    const result = await handler(APPSYNC_EVENT);
    expect(result).toEqual([]);
  });

  it("issues exactly one Scan call", async () => {
    mockDynamoSend.mockResolvedValue({ Items: [] });
    await handler(APPSYNC_EVENT);
    expect(mockDynamoSend).toHaveBeenCalledOnce();
  });

  it("propagates DynamoDB errors", async () => {
    mockDynamoSend.mockRejectedValue(new Error("DynamoDB unavailable"));
    await expect(handler(APPSYNC_EVENT)).rejects.toThrow("DynamoDB unavailable");
  });
});
