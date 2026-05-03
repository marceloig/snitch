import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDynamoSend,
  mockSsoSend,
  mockGetIDCInstance,
} = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
  mockSsoSend: vi.fn(),
  mockGetIDCInstance: vi.fn(),
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

vi.mock("@aws-sdk/client-sso-admin", () => ({
  SSOAdminClient: class {
    send = mockSsoSend;
  },
  DeleteAccountAssignmentCommand: class {
    constructor(public input: unknown) {}
  },
  StatusValues: { FAILED: "FAILED", IN_PROGRESS: "IN_PROGRESS", SUCCEEDED: "SUCCEEDED" },
}));

vi.mock("../../amplify/functions/awsResources/helpers", () => ({
  getIDCInstancePublic: mockGetIDCInstance,
}));

const { handler } = await import(
  "../../amplify/functions/accessRequests/removePermissionSetHandler"
);

const BASE_INPUT = {
  requestId: "req-1",
  idcUserId: "user-abc",
  accountId: "111111111111",
  permissionSetArn: "arn:aws:sso:::permissionSet/ssoins-1/ps-read",
  durationSeconds: 3600,
};

describe("removePermissionSetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_REQUEST_TABLE_NAME = "AccessRequestTable";
    mockGetIDCInstance.mockResolvedValue({ instanceArn: "arn:aws:sso:::instance/ssoins-1" });
    mockDynamoSend.mockResolvedValue({});
  });

  it("calls DeleteAccountAssignment with correct parameters", async () => {
    mockSsoSend.mockResolvedValue({
      AccountAssignmentDeletionStatus: { Status: "SUCCEEDED" },
    });

    await handler(BASE_INPUT);

    expect(mockSsoSend).toHaveBeenCalledOnce();
    const cmd = mockSsoSend.mock.calls[0][0];
    expect(cmd.input).toMatchObject({
      InstanceArn: "arn:aws:sso:::instance/ssoins-1",
      TargetId: BASE_INPUT.accountId,
      TargetType: "AWS_ACCOUNT",
      PermissionSetArn: BASE_INPUT.permissionSetArn,
      PrincipalType: "USER",
      PrincipalId: BASE_INPUT.idcUserId,
    });
  });

  it("updates DynamoDB status to EXPIRED on natural expiry", async () => {
    mockSsoSend.mockResolvedValue({
      AccountAssignmentDeletionStatus: { Status: "SUCCEEDED" },
    });

    await handler(BASE_INPUT);

    expect(mockDynamoSend).toHaveBeenCalledOnce();
    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: BASE_INPUT.requestId });
    expect(cmd.input.ExpressionAttributeValues[":s"]).toBe("EXPIRED");
  });

  it("updates DynamoDB status to REVOKED when revokedByAdmin is true", async () => {
    mockSsoSend.mockResolvedValue({
      AccountAssignmentDeletionStatus: { Status: "SUCCEEDED" },
    });

    await handler({ ...BASE_INPUT, revokedByAdmin: true });

    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[":s"]).toBe("REVOKED");
  });

  it("updates DynamoDB status to EXPIRED when revokedByAdmin is false", async () => {
    mockSsoSend.mockResolvedValue({
      AccountAssignmentDeletionStatus: { Status: "SUCCEEDED" },
    });

    await handler({ ...BASE_INPUT, revokedByAdmin: false });

    const cmd = mockDynamoSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[":s"]).toBe("EXPIRED");
  });

  it("throws when DeleteAccountAssignment returns FAILED status", async () => {
    mockSsoSend.mockResolvedValue({
      AccountAssignmentDeletionStatus: {
        Status: "FAILED",
        FailureReason: "Assignment not found",
      },
    });

    await expect(handler(BASE_INPUT)).rejects.toThrow(
      "DeleteAccountAssignment failed for request req-1: Assignment not found"
    );
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  it("propagates SSO Admin errors", async () => {
    mockSsoSend.mockRejectedValue(new Error("SSO unavailable"));
    await expect(handler(BASE_INPUT)).rejects.toThrow("SSO unavailable");
  });
});
