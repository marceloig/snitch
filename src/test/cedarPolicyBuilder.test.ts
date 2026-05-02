import { describe, it, expect } from "vitest";
import { buildCedarPolicy } from "../../amplify/functions/verifiedPermissions/cedarPolicyBuilder";

describe("buildCedarPolicy", () => {
  const PS_ARN = "arn:aws:sso:::permissionSet/ssoins-1/ps-abc";

  describe("principal", () => {
    it("uses == for USER principal", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`principal == Snitch::User::"user-1"`);
    });

    it("uses in for GROUP principal", () => {
      const policy = buildCedarPolicy({
        principalType: "GROUP",
        principalId: "group-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`principal in Snitch::Group::"group-1"`);
    });
  });

  describe("resource clauses", () => {
    it("emits account resource clause", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`resource in Snitch::Account::"111111111111"`);
    });

    it("emits OU resource clause", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: [],
        ouIds: ["ou-root-abc123"],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`resource in Snitch::OU::"ou-root-abc123"`);
    });

    it("OR-joins multiple resource clauses", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111", "222222222222"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`resource in Snitch::Account::"111111111111"`);
      expect(policy).toContain(`resource in Snitch::Account::"222222222222"`);
      expect(policy).toContain("||");
    });

    it("mixes accounts and OUs in resource clauses", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: ["ou-root-abc123"],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`resource in Snitch::Account::"111111111111"`);
      expect(policy).toContain(`resource in Snitch::OU::"ou-root-abc123"`);
    });

    it("omits resource clause when no accounts or OUs", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: [],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      // when-body is only the permissionSet clause — no resource in clause
      expect(policy).not.toContain("resource in Snitch::");
      expect(policy).toContain(".contains(context.permissionSetArn)");
    });
  });

  describe("permission set clause", () => {
    it("encodes a single permission set ARN", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`["${PS_ARN}"].contains(context.permissionSetArn)`);
    });

    it("encodes multiple permission set ARNs", () => {
      const ps2 = "arn:aws:sso:::permissionSet/ssoins-1/ps-xyz";
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN, ps2],
      });
      expect(policy).toContain(`"${PS_ARN}"`);
      expect(policy).toContain(`"${ps2}"`);
      expect(policy).toContain(".contains(context.permissionSetArn)");
    });
  });

  describe("output structure", () => {
    it("always starts with permit and ends with semicolon", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: ["111111111111"],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy.trimStart()).toMatch(/^permit \(/);
      expect(policy.trimEnd()).toMatch(/\};$/);
    });

    it("always includes the assume action", () => {
      const policy = buildCedarPolicy({
        principalType: "USER",
        principalId: "user-1",
        accountIds: [],
        ouIds: [],
        permissionSetArns: [PS_ARN],
      });
      expect(policy).toContain(`action == Snitch::Action::"assume"`);
    });
  });
});
