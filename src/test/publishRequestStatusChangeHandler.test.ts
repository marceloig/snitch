import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

// Module-level constants capture these at import time — set them first.
process.env.APPSYNC_GRAPHQL_URL = "https://example.appsync-api.us-east-1.amazonaws.com/graphql";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "AKIAFAKE";
process.env.AWS_SECRET_ACCESS_KEY = "fake-secret";
process.env.AWS_SESSION_TOKEN = "fake-token";

const { handler, collectStatusChanges } = await import(
  "../../amplify/functions/accessRequests/publishRequestStatusChangeHandler"
);

/** Minimal stand-in for the fetch Response shape the handler reads. */
class FakeGraphQLResponse {
  constructor(
    public readonly ok: boolean,
    public readonly status: number,
    private readonly payload: unknown
  ) {}

  async json(): Promise<unknown> {
    return this.payload;
  }
}

function modifyRecord(
  id: string,
  oldStatus: string | undefined,
  newStatus: string,
  updatedAt = "2024-01-02T10:00:00Z"
): DynamoDBRecord {
  return {
    eventName: "MODIFY",
    dynamodb: {
      NewImage: {
        id: { S: id },
        status: { S: newStatus },
        updatedAt: { S: updatedAt },
      },
      ...(oldStatus ? { OldImage: { id: { S: id }, status: { S: oldStatus } } } : {}),
    },
  } as DynamoDBRecord;
}

function streamEvent(records: DynamoDBRecord[]): DynamoDBStreamEvent {
  return { Records: records };
}

describe("collectStatusChanges", () => {
  it("returns the change when the status differs from the old image", () => {
    const changes = collectStatusChanges([modifyRecord("req-1", "ACTIVE", "REVOKED")]);
    expect(changes).toEqual([
      { requestId: "req-1", status: "REVOKED", updatedAt: "2024-01-02T10:00:00Z" },
    ]);
  });

  it("ignores writes that leave the status untouched", () => {
    // storeActiveToken and revokeAccess both write while status stays ACTIVE.
    expect(collectStatusChanges([modifyRecord("req-1", "ACTIVE", "ACTIVE")])).toEqual([]);
  });

  it("treats a record with no old image as a change", () => {
    const changes = collectStatusChanges([modifyRecord("req-1", undefined, "PENDING")]);
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe("PENDING");
  });

  it("ignores records with no new image", () => {
    const removeRecord = { eventName: "REMOVE", dynamodb: {} } as DynamoDBRecord;
    expect(collectStatusChanges([removeRecord])).toEqual([]);
  });

  it("keeps only the newest status when one request changes twice in a batch", () => {
    const changes = collectStatusChanges([
      modifyRecord("req-1", "PENDING", "ACTIVE"),
      modifyRecord("req-1", "ACTIVE", "EXPIRED"),
    ]);
    expect(changes).toEqual([
      { requestId: "req-1", status: "EXPIRED", updatedAt: "2024-01-02T10:00:00Z" },
    ]);
  });

  it("returns one change per request when several change in a batch", () => {
    const changes = collectStatusChanges([
      modifyRecord("req-1", "ACTIVE", "EXPIRED"),
      modifyRecord("req-2", "PENDING_APPROVAL", "REJECTED"),
    ]);
    expect(changes.map((c) => c.requestId)).toEqual(["req-1", "req-2"]);
  });

  it("defaults updatedAt to an empty string when the image has none", () => {
    const record = {
      eventName: "MODIFY",
      dynamodb: { NewImage: { id: { S: "req-1" }, status: { S: "FAILED" } } },
    } as DynamoDBRecord;
    expect(collectStatusChanges([record])[0].updatedAt).toBe("");
  });
});

describe("publishRequestStatusChange handler", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new FakeGraphQLResponse(true, 200, { data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the publish mutation once per changed request", async () => {
    await handler(
      streamEvent([
        modifyRecord("req-1", "ACTIVE", "EXPIRED"),
        modifyRecord("req-2", "ACTIVE", "REVOKED"),
      ]),
      {} as never,
      () => {}
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.variables).toEqual({
      requestId: "req-1",
      status: "EXPIRED",
      updatedAt: "2024-01-02T10:00:00Z",
    });
    expect(body.query).toContain("publishAccessRequestStatus");
  });

  it("signs the request with SigV4", async () => {
    await handler(streamEvent([modifyRecord("req-1", "ACTIVE", "EXPIRED")]), {} as never, () => {});

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(headers["x-amz-security-token"]).toBe("fake-token");
  });

  it("does not publish when no status changed", async () => {
    await handler(streamEvent([modifyRecord("req-1", "ACTIVE", "ACTIVE")]), {} as never, () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A throw would retry the whole batch and stall the stream shard.
  it("swallows a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("connect ETIMEDOUT"));
    await expect(
      handler(streamEvent([modifyRecord("req-1", "ACTIVE", "EXPIRED")]), {} as never, () => {})
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("swallows a GraphQL error response and still publishes the rest of the batch", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new FakeGraphQLResponse(true, 200, { errors: [{ message: "Unauthorized" }] })
      )
      .mockResolvedValue(new FakeGraphQLResponse(true, 200, { data: {} }));

    await handler(
      streamEvent([
        modifyRecord("req-1", "ACTIVE", "EXPIRED"),
        modifyRecord("req-2", "ACTIVE", "REVOKED"),
      ]),
      {} as never,
      () => {}
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });
});
