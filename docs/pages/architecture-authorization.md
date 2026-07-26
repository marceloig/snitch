---
title: Authorization
layout: default
parent: Architecture
nav_order: 5
---

# Authorization
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Why AVP Is the Enforcement Point

AWS Verified Permissions is the authoritative source for every access decision in Snitch. Each `PrivilegedPolicy` and `ApprovalPolicy` record is mirrored as a Cedar policy in a policy store configured with **STRICT** schema validation against the `Snitch` namespace.

DynamoDB is the application record; AVP decides. No handler ever reads a policy from DynamoDB and interprets it — the answer always comes from `IsAuthorized`. That's what keeps an application bug from being able to grant access that policy doesn't permit.

---

## Cedar Schema

The `Snitch` namespace defines six entity types and two actions.

### `assume`

Whether a principal may request access to an account with a given permission set.

| Element | Type |
|---|---|
| Principal | `Snitch::User` (memberOf `Snitch::Group`) \| `Snitch::Group` |
| Resource | `Snitch::Account` (memberOf `Snitch::OU`) \| `Snitch::OU` |
| Action | `Snitch::Action::"assume"` |
| Context | `{ permissionSetArn: String (required) }` |

### `approve`

Whether a principal may approve someone else's request for an account.

| Element | Type |
|---|---|
| Principal | `Snitch::Approver` (memberOf `Snitch::ApproverGroup`) \| `Snitch::ApproverGroup` |
| Resource | `Snitch::Account` |
| Action | `Snitch::Action::"approve"` |
| Context | `{ permissionSetArn: String (required) }` |

Note that `approve` reuses `Snitch::Account` as its resource. The permission set is *not* the resource — it's a `when`-clause condition narrowing which requests on that account the approver may act on.

**Groups always come from IAM Identity Center.** Snitch uses no Cognito user-pool groups anywhere. The pre-token-generation trigger fills `cognito:groups` with the user's immutable Identity Center GroupIds, so `Snitch::Group` and `Snitch::ApproverGroup` key on the same identifiers — a group grant behaves identically for requesting and approving.

The two actions keep separate principal entity types only because they identify an *individual* differently: `assume` by Identity Center user id, `approve` by the caller's Cognito sign-in username. Group identity is Identity Center in both.

---

## Identity Model

AppSync forwards the Cognito **access token** to Lambda resolvers, never the ID token. The access token carries `sub`, `cognito:groups`, and the standard OIDC fields — custom attributes such as `email` are absent.

{: .warning }
Never read `event.identity.claims["email"]`. It is always undefined.

For SAML-federated users, Cognito formats the username as `<providerName>_<samlNameId>`. The provider is `IDC` (stored lowercase) and the NameID is the user's email, so `alice@example.com` signs in as `idc_alice@example.com`. Handlers that need the email strip the prefix:

```typescript
const IDC_USERNAME_PREFIX = "idc_";
const email = username.startsWith(IDC_USERNAME_PREFIX)
  ? username.slice(IDC_USERNAME_PREFIX.length)
  : undefined;
```

`getMyIDCUserHandler.ts` is the reference implementation; other handlers should follow it.

This also explains the self-approval guard. `requestAccessHandler` stores `event.identity.username` as `requesterCognitoSub` when the request is created, and the approve and reject handlers compare it against their own caller. Comparing emails wouldn't work, since the token has none. Records written before the field existed have it `undefined`, so both handlers guard with `if (request.requesterCognitoSub && …)`.

---

## Group Claims

`preTokenGenerationHandler` runs at token issue time. It resolves the signing-in user's Identity Center group memberships and writes their **GroupIds** into `cognito:groups`. It then appends a literal string when the corresponding environment variable matches one of those GroupIds:

| Environment variable | Claim added |
|---|---|
| `ADMIN_GROUP_ID` | `Admins` |
| `AUDITOR_GROUP_ID` | `Auditors` |

Keying on the immutable GroupId rather than the group name means renaming a group in Identity Center never breaks access. `AUDITOR_GROUP_ID` is optional and defaults to `""` — unset, no user ever receives the `Auditors` claim, which is the backward-safe default.

Neither claim corresponds to a real Cognito user-pool group. `allow.group("Admins")` matches the injected string directly.

---

## What the Auditors Claim Gates

Exactly four things:

- `listAllAccessRequests` and `getCloudTrailLogs`, both `allow.groups(["Admins", "Auditors"])`
- the `onAccessRequestStatusChanged` subscription, same rule
- the `/approval-history` and `/session-activity` routes, wrapped in `<GroupGuard group="Auditors">` in `src/App.tsx`

`GroupGuard` is the general form; `AdminGuard` is a thin wrapper over it for `"Admins"`. Auditors get no mutations at all — the read-only guarantee comes from the absence of any rule granting them one, not from UI state.

---

## `assume` Authorization Check

Used by `evaluateAccessHandler` to work out which `(accountId, permissionSetArn)` pairs a user may request.

```typescript
{
  principal: { entityType: "Snitch::User", entityId: "<idc-user-id>" },
  action:    { actionType: "Snitch::Action", actionId: "assume" },
  resource:  { entityType: "Snitch::Account", entityId: "<account-id>" },
  context:   { contextMap: { permissionSetArn: { string: "<arn>" } } },
  entities:  // the user's IDC group memberships, as Snitch::User → parents Snitch::Group
}
```

The handler scans DynamoDB for every candidate pair, runs these checks in parallel, and keeps only the ALLOWs. Those become the account and permission-set dropdowns on the Request Access page.

{: .important }
Group parents must always be injected in `entities`, or `principal in Snitch::Group::"…"` policies silently evaluate to DENY.

---

## `approve` Authorization Check

Used by `approveRequestHandler`, `rejectRequestHandler`, and `listPendingApprovalsHandler`.

```typescript
{
  principal: { entityType: "Snitch::Approver", entityId: "<cognito-username>" },
  action:    { actionType: "Snitch::Action", actionId: "approve" },
  resource:  { entityType: "Snitch::Account", entityId: "<account-id>" },
  context:   { contextMap: { permissionSetArn: { string: "<arn>" } } },
  entities:  // the caller's IDC GroupIds from cognito:groups,
             // as Snitch::Approver → parents Snitch::ApproverGroup
}
```

The Slack approval path builds the identical check, resolving the same two identifiers from a Slack user id instead of from a token. See [Notifications & Slack Integration]({% link pages/architecture-integrations.md %}#approval-path).

---

## Cedar Policy Builders

Both builders are pure functions with no I/O, which is what makes them exhaustively unit-testable.

### `buildCedarPolicy` — the `assume` statement

`amplify/functions/verifiedPermissions/cedarPolicyBuilder.ts`. The `when` clause OR-joins the accounts and OUs, then constrains the permission set:

```cedar
permit (
  principal == Snitch::User::"abc-123",
  action == Snitch::Action::"assume",
  resource
) when {
  (
    resource in Snitch::Account::"111111111111" ||
    resource in Snitch::OU::"ou-root-xxxx"
  ) &&
  ["arn:aws:sso:::permissionSet/ps-1"].contains(context.permissionSetArn)
};
```

Group principals use `principal in Snitch::Group::"<id>"` instead of `==`.

### `buildApprovalCedarPolicy` — the `approve` statement

`amplify/functions/verifiedPermissions/buildApprovalCedarPolicy.ts`. The account is the resource; at least one permission set ARN is always required in the `when` clause:

```cedar
// USER approver
permit (
  principal == Snitch::Approver::"alice",
  action == Snitch::Action::"approve",
  resource == Snitch::Account::"111111111111"
) when {
  ["arn:aws:sso:::permissionSet/ps-1"].contains(context.permissionSetArn)
};

// GROUP approver — the principal id is the immutable IDC GroupId
permit (
  principal in Snitch::ApproverGroup::"a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  action == Snitch::Action::"approve",
  resource == Snitch::Account::"111111111111"
) when {
  ["arn:aws:sso:::permissionSet/ps-1"].contains(context.permissionSetArn)
};
```

---

## Policy Lifecycle

Write ordering and rollback targets for the DynamoDB ↔ AVP dual write are documented in [Data Model & Storage → Compensating Transactions]({% link pages/architecture-data.md %}#compensating-transactions).

---

## Conflict Enforcement

`amplify/functions/verifiedPermissions/policyConflictChecker.ts` runs at the top of both the create and update privileged-policy handlers, before any write to either store. It scans for existing policies with the same `principalId` and overlapping `accountIds` or `ouIds`; the `excludeId` parameter lets an update skip its own record.

The Privileged Policies page runs the same check client-side against its loaded state for immediate feedback, but the backend check is the authoritative one.

---

## AVP IAM Permissions

| Handlers | AVP actions |
|---|---|
| `createPrivilegedPolicy`, `updatePrivilegedPolicy`, `deletePrivilegedPolicy` | `CreatePolicy`, `UpdatePolicy`, `DeletePolicy` |
| `createApprovalPolicy`, `deleteApprovalPolicy` | `CreatePolicy`, `DeletePolicy` |
| `evaluateAccess`, `approveRequest`, `rejectRequest`, `listPendingApprovals`, `slackInteractive` | `IsAuthorized` |

All scoped to the policy store ARN. `AVP_POLICY_STORE_ID` is injected by `amplify/policyStore.ts` and `amplify/slackHandler.ts` — not by `backend.ts`.
