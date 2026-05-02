import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these are initialised before vi.mock factories run,
// which is necessary because vi.mock is hoisted to the top of the file.
const { mockCognitoSend, mockGetMyIDCUser } = vi.hoisted(() => ({
  mockCognitoSend: vi.fn(),
  mockGetMyIDCUser: vi.fn(),
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = mockCognitoSend;
  },
  AdminGetUserCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../../amplify/functions/awsResources/helpers", () => ({
  getMyIDCUser: mockGetMyIDCUser,
}));

const { handler } = await import(
  "../../amplify/functions/awsResources/getMyIDCUserHandler"
);

const SUB = "f1dbb560-f081-70be-433e-03eee2b4219b";
const EMAIL = "alice@example.com";

const IDC_USER = {
  id: "idc-user-1",
  userName: "alice",
  displayName: "Alice",
  email: EMAIL,
};

function makeEvent(username: string, claimsSub?: string) {
  return {
    identity: {
      username,
      claims: claimsSub ? { sub: claimsSub } : {},
    },
  };
}

describe("getMyIDCUserHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_USER_POOL_ID = "us-east-1_TestPool";
    mockCognitoSend.mockResolvedValue({
      UserAttributes: [{ Name: "email", Value: EMAIL }],
    });
    mockGetMyIDCUser.mockResolvedValue(IDC_USER);
  });

  it("resolves sub from claims and returns the matching IDC user", async () => {
    const result = await handler(makeEvent("ignored-username", SUB));
    expect(mockGetMyIDCUser).toHaveBeenCalledWith(EMAIL);
    expect(result).toEqual(IDC_USER);
  });

  it("falls back to identity.username when claims.sub is absent", async () => {
    // Access token shape: no sub in claims, username is the sub UUID
    const result = await handler(makeEvent(SUB));
    expect(mockCognitoSend).toHaveBeenCalledOnce();
    expect(result).toEqual(IDC_USER);
  });

  it("throws when no sub is found in identity", async () => {
    const event = { identity: { username: "", claims: {} } };
    await expect(handler(event)).rejects.toThrow("No sub found in identity");
  });

  it("throws when Cognito user has no email attribute", async () => {
    mockCognitoSend.mockResolvedValue({ UserAttributes: [] });
    await expect(handler(makeEvent(SUB, SUB))).rejects.toThrow(
      `Cognito user ${SUB} has no email attribute`
    );
  });

  it("returns null when no IDC user matches the email", async () => {
    mockGetMyIDCUser.mockResolvedValue(null);
    const result = await handler(makeEvent(SUB, SUB));
    expect(result).toBeNull();
  });

  it("propagates Cognito SDK errors", async () => {
    mockCognitoSend.mockRejectedValue(new Error("Cognito unavailable"));
    await expect(handler(makeEvent(SUB, SUB))).rejects.toThrow("Cognito unavailable");
  });
});
