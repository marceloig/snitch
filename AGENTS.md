# Snitch — Privileged Access Management

## Product Overview

A fullstack application for managing privileged access to AWS accounts. Admins define policies that grant IAM Identity Center (IDC) users or groups access to specific AWS accounts and OUs using chosen Permission Sets. Each policy is stored in DynamoDB and mirrored as a Cedar policy in AWS Verified Permissions, which is the authoritative source for access evaluation.

**Core features:**
- User authentication with Amazon Cognito (Admins group gates all access)
- Privileged policy management (create, read, update, delete) with conflict enforcement (one policy per principal + resource)
- Cedar policy authoring via `buildCedarPolicy` — policies are stored in AVP and evaluated at request time
- AWS resource discovery: IDC users/groups, Cognito users/groups, AWS accounts, OUs, Permission Sets
- JIT access requests with a Step Functions workflow: assign permission set → wait → revoke
- Optional approval gate on policies: requests pause at `PENDING_APPROVAL` until an admin approves or rejects (or the 24-hour timeout fires)
- Responsive UI built with Cloudscape Design System

## Technology Stack

- **Frontend**: React 18 + TypeScript, Vite, Cloudscape Design System
- **Backend**: AWS Amplify Gen 2 (AppSync GraphQL + DynamoDB + Cognito)
- **Authorization**: AWS Verified Permissions (Cedar policies, STRICT schema validation)
- **Testing**: Vitest + React Testing Library (jsdom environment)

### Common Commands

```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Build for production (tsc -b && vite build)
npm run test             # Run tests once
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run sandbox          # Deploy Amplify sandbox
```

## Project Structure

```
snitch/
├── amplify/
│   ├── auth/resource.ts        # Cognito config; defines the "Admins" user pool group
│   ├── data/resource.ts        # AppSync schema: PrivilegedPolicy model + AVP-backed mutations
│   ├── backend.ts              # CDK wiring: AVP policy store, IAM grants, env vars
│   └── functions/
│       ├── awsResources/       # Lambda resolvers: list IDC users/groups, accounts, OUs, permission sets
│       └── verifiedPermissions/
│           ├── cedarPolicyBuilder.ts           # Pure function: builds Cedar PERMIT statement
│           ├── createPrivilegedPolicyHandler.ts
│           ├── updatePrivilegedPolicyHandler.ts
│           └── deletePrivilegedPolicyHandler.ts
├── src/
│   ├── components/             # Reusable UI components
│   ├── hooks/                  # Custom React hooks
│   ├── utils/                  # Helper functions
│   ├── types/                  # Shared TypeScript types
│   ├── pages/
│   │   ├── PrivilegedPoliciesPage.tsx  # Admin CRUD for privileged policies (with approval config)
│   │   ├── RequestAccessPage.tsx       # End-user JIT access request form + request history
│   │   └── ApproveRequestsPage.tsx     # Admin page: review, approve, or reject pending requests
│   ├── test/
│   │   └── setup.ts            # Vitest setup (jest-dom matchers)
│   ├── App.tsx
│   └── main.tsx                # Entry point with Amplify config
├── amplify_outputs.json        # Generated backend outputs
├── vite.config.ts
└── tsconfig.json
```

## Privileged Policy — Approval Configuration

Each `PrivilegedPolicy` can optionally require an admin to approve requests before access is granted. The relevant fields stored on the policy record:

| Field | Type | Purpose |
|---|---|---|
| `requiresApproval` | boolean | Enables the approval gate for all requests under this policy |
| `approverUsernames` | string[] | Cognito usernames of users who can approve/reject |
| `approverGroupNames` | string[] | Cognito group names whose members can approve/reject |

When `requiresApproval` is `true`:
1. The `evaluateMyAccess` query returns `requiresApproval: true` for the matching `(accountId, permissionSetArn)` pair.
2. The Request Access form shows an info alert warning the user that approval is required.
3. On submission, `requestAccess` creates the record with `status: "PENDING_APPROVAL"` and the Step Function pauses at `WaitForApproval`.
4. The `Approve Requests` page (admin-only) lists requests pending the current admin's review.
5. `approveRequest` / `rejectRequest` mutations resume or terminate the Step Function execution.

### Access Request Statuses

| Status | Meaning |
|---|---|
| `PENDING` | No approval required; waiting for Step Functions to assign the permission set |
| `PENDING_APPROVAL` | Waiting for an approver to act; Step Function is paused |
| `ACTIVE` | Permission set assigned; timer running |
| `EXPIRED` | Duration elapsed (access revoked) or 24-hour approval timeout fired |
| `REJECTED` | An approver rejected the request |
| `FAILED` | Unrecoverable error in the workflow |

### Approval Workflow — Step Functions States

```
CheckApproval (Choice)
  requiresApproval = true  →  WaitForApproval (waitForTaskToken, HeartbeatSeconds: 86400)
  default                  →  AssignPermissionSet

WaitForApproval
  on SendTaskSuccess        →  AssignPermissionSet → WaitForDuration → RemovePermissionSet
  on "RequestRejected"      →  RejectionHandled (Pass — DDB already set to REJECTED)
  on States.HeartbeatTimeout→  SetStatusExpired (DynamoDB SDK integration, no Lambda)
  on States.ALL             →  SetStatusFailed

AssignPermissionSet → WaitForDuration → RemovePermissionSet
```

`SetStatusExpired` uses `arn:aws:states:::aws-sdk:dynamodb:updateItem` directly — no Lambda cold start needed since only `$.requestId` from state context is required.

### New Lambda Handlers (`amplify/functions/accessRequests/`)

| Handler | Stack | Purpose |
|---|---|---|
| `storeApprovalTokenHandler.ts` | AccessRequestWorkflow | Called by WaitForApproval state; stores task token, sets `PENDING_APPROVAL` |
| `approveRequestHandler.ts` | data | Validates approver, calls `SendTaskSuccess`, resumes state machine |
| `rejectRequestHandler.ts` | data | Validates approver, sets `REJECTED` atomically, calls `SendTaskFailure` |
| `listPendingApprovalsHandler.ts` | data | Returns `PENDING_APPROVAL` requests the calling admin can act on |

`approveRequest`, `rejectRequest`, `listPendingApprovals` are in the `data` stack (`resourceGroupName: "data"`) — see `CLAUDE.md` for why.

## AWS Verified Permissions Integration

### Overview

Every `PrivilegedPolicy` record has a corresponding Cedar policy in AVP. The policy store uses **STRICT** schema validation against the `Snitch` Cedar namespace. AVP is the authoritative store for access decisions — DynamoDB is the application record.

### Cedar Schema (`Snitch` namespace)

```
Principal: Snitch::User (memberOf Group) | Snitch::Group
Resource:  Snitch::Account (memberOf OU) | Snitch::OU (memberOf OU)
Action:    Snitch::Action::"assume"
Context:   { permissionSetArn: String (required) }
```

### Policy Lifecycle

All three mutations (`createPrivilegedPolicyWithAVP`, `updatePrivilegedPolicyWithAVP`, `deletePrivilegedPolicyWithAVP`) are AppSync custom resolvers backed by Lambda. They keep DynamoDB and AVP in sync with compensating transactions:

| Mutation | Order | Rollback on failure |
|---|---|---|
| Create | AVP first → DynamoDB | Delete AVP policy |
| Update | DynamoDB first → AVP | Restore DynamoDB snapshot |
| Delete | DynamoDB first → AVP | Restore DynamoDB snapshot |

The `avpPolicyId` returned by AVP is stored on the DynamoDB item and used for subsequent updates and deletes.

### Cedar Policy Shape

`buildCedarPolicy` in `cedarPolicyBuilder.ts` produces a PERMIT statement. The `when` clause encodes:
- **Resources**: specific `Account` or `OU` entities (OR-joined)
- **Permission set**: `context.permissionSetArn` must be in the allowed set

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

Groups use `principal in Snitch::Group::"<id>"` instead of `==`.

### Environment Variables (Lambda)

| Variable | Source |
|---|---|
| `AVP_POLICY_STORE_ID` | Set by `backend.ts` from `CfnPolicyStore.attrPolicyStoreId` |
| `PRIVILEGED_POLICY_TABLE_NAME` | Set by `backend.ts` from the DynamoDB table name |

### IAM Permissions

The three AVP Lambda functions are granted:
- `verifiedpermissions:CreatePolicy`, `UpdatePolicy`, `DeletePolicy` — scoped to the policy store ARN
- `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` — scoped to the `PrivilegedPolicy` table ARN

### Adding Access Evaluation

When implementing a request-time authorization check, use `IsAuthorized` or `IsAuthorizedWithToken` from the AVP SDK. Pass:
- `principal`: `{ entityType: "Snitch::User", entityId: "<idc-user-id>" }`
- `action`: `{ actionType: "Snitch::Action", actionId: "assume" }`
- `resource`: `{ entityType: "Snitch::Account", entityId: "<account-id>" }`
- `context`: `{ contextMap: { permissionSetArn: { string: "<arn>" } } }`
- `entities`: include group memberships so AVP can resolve `principal in Group` policies

## Import Patterns

```typescript
// Amplify data client
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

// Cloudscape — import per-component, not from index
import AppLayout from "@cloudscape-design/components/app-layout";
import Table from "@cloudscape-design/components/table";

// Amplify auth
import { useAuthenticator } from "@aws-amplify/ui-react";

// Src imports use the @/* alias
import App from "@/App";
```

## Code Style

### Functions & Files
- Functions: 4–20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility.
- One responsibility per module; early returns over nested ifs; max 2 levels of indentation.

### Naming
- Names must be specific and unique. Avoid `data`, `handler`, `Manager`.
- Prefer names that return fewer than 5 grep hits in the codebase.
- Components: PascalCase (`TodoList.tsx`). Utilities: camelCase (`formatDate.ts`). Tests: `ComponentName.test.tsx`.

### Types
- Explicit types everywhere. No `any`, no untyped functions.
- TypeScript strict mode is enabled — honor it.

### Duplication
- No code duplication. Extract shared logic into a named function or module.

### Error Messages
```typescript
throw new Error(`Expected PrivilegedPolicy id to be a non-empty string, got: ${JSON.stringify(id)}`);
```

### Formatting
- Use Prettier for all formatting.

## Comments
- Write WHY, not WHAT.
- Docstrings on public functions: intent + one usage example.
- Reference issue numbers or commit SHAs when a line exists because of a specific bug or upstream constraint.

## Dependencies & Architecture
- Inject dependencies through constructor/parameter, not globals or module-level imports.
- Wrap third-party libraries (Amplify client, Cloudscape, AVP SDK) behind a thin interface when reuse or testing requires it.

## Testing Rules
- Every new function gets a test. Bug fixes get a regression test.
- Mock external I/O (Amplify API, DynamoDB, AVP SDK) with named fake classes, not inline stubs.
- Tests must be F.I.R.S.T: fast, independent, repeatable, self-validating, timely.
- `buildCedarPolicy` must be tested with unit tests covering: USER vs GROUP principal, accounts-only, OUs-only, mixed, empty resource lists.
- Setup file: `src/test/setup.ts`. Test files: `.test.tsx` suffix.

## State Management
- Use React hooks (`useState`, `useReducer`) for local state.
- Use context for global state when needed.
- Keep state as close to usage as possible.
- Use `useCallback` for memoized functions passed to child components.

## Logging
- Structured JSON for debugging and observability (e.g., CloudWatch logs).
- Plain text only for user-facing CLI output.
