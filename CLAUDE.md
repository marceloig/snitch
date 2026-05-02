# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

If you don't know how to do something, don't guess — ask me to guide you.

---

## Commands

```bash
npm run dev              # Vite dev server → http://localhost:5173
npm run build            # tsc -b && vite build
npm run test             # Vitest single run (all tests)
npm run test:watch       # Vitest watch mode
npm run test:coverage    # With coverage report
npm run sandbox          # Deploy / hot-reload Amplify Gen 2 sandbox
```

**Run a single test file:**
```bash
npx vitest run src/test/cedarPolicyBuilder.test.ts
```

**Run tests matching a name pattern:**
```bash
npx vitest run --reporter=verbose -t "conflict"
```

---

## Architecture: how the pieces connect

### IAM permission wiring lives entirely in `amplify/backend.ts`

Every Lambda's IAM role is assembled here. If a handler needs a new AWS action (DynamoDB, AVP, SSO, etc.) the `PolicyStatement` must be added here — the handler itself has no inline IAM config. This is the first place to check when seeing `is not authorized to perform` errors.

### Two data stores, one source of truth

`PrivilegedPolicy` records exist in both **DynamoDB** (application metadata) and **AWS Verified Permissions** (Cedar policies). AVP is the authoritative source for access decisions. DynamoDB stores the `avpPolicyId` foreign key used for updates and deletes. The compensating-transaction order in each handler (create: AVP first → DDB; update/delete: DDB first → AVP) means a partial failure always leaves the rollback target reachable.

### Conflict enforcement: one policy per (principal, resource)

`amplify/functions/verifiedPermissions/policyConflictChecker.ts` is called at the top of both `createPrivilegedPolicyHandler` and `updatePrivilegedPolicyHandler` — before any AVP or DDB writes. It scans for existing policies with the same `principalId` and overlapping `accountIds`/`ouIds`. The `excludeId` parameter lets updates skip their own record.

The frontend (`PrivilegedPoliciesPage.tsx → validate()`) performs the same check against the locally loaded `policies` state for immediate UX feedback, but the backend check is authoritative.

### Access evaluation path (`evaluateMyAccess`)

`evaluateAccessHandler.ts` ties together four AWS services in a single Lambda invocation:
1. IDC IdentityStore — resolve group memberships for the calling user
2. DynamoDB Scan — collect every `(accountId, permissionSetArn)` candidate across all policies
3. AVP `IsAuthorized` (parallel) — filter candidates where Cedar returns ALLOW; group parents are injected so `principal in Snitch::Group` policies resolve
4. Returns only ALLOW pairs → drives the account and permission-set dropdowns in `RequestAccessPage`

### JIT access workflow (`amplify/accessRequestWorkflow.ts`)

A separate CDK construct (to avoid circular dependencies with the data stack) that owns:
- A standalone DynamoDB table (`AccessRequestTable`) with a GSI on `idcUserId` for per-user queries
- A Step Functions state machine: `AssignPermissionSet → WaitForDuration → RemovePermissionSet`, with a `Catch` → `SetStatusFailed` on all states
- All Lambda handlers in `amplify/functions/accessRequests/` share a common `maxDurationMinutes` enforcement: max 23:59 (1439 minutes), enforced at the policy level and validated in the UI before the `requestAccess` mutation is called

### `amplify/data/resource.ts` is the GraphQL contract

All AppSync queries/mutations and their Lambda resolvers are declared here. Adding a new Lambda-backed operation requires: (1) a function resource in a `resource.ts` file, (2) an entry in this schema, (3) import + registration in `backend.ts`, and (4) the IAM grants in `backend.ts`.
