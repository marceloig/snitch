# Snitch — Privileged Access Management

## Product Overview

A fullstack application for managing privileged access to AWS accounts. Admins define policies that grant IAM Identity Center (IDC) users or groups access to specific AWS accounts and OUs using chosen Permission Sets. Each policy is stored in DynamoDB and mirrored as a Cedar policy in AWS Verified Permissions, which is the authoritative source for access evaluation.

**Core features:**
- User authentication with Amazon Cognito (Admins group gates all access)
- Privileged policy management (create, read, update, delete)
- Cedar policy authoring via `buildCedarPolicy` — policies are stored in AVP and evaluated at request time
- AWS resource discovery: IDC users/groups, AWS accounts, OUs, Permission Sets
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
│   │   └── PrivilegedPoliciesPage.tsx  # Full CRUD UI for privileged policies
│   ├── test/
│   │   └── setup.ts            # Vitest setup (jest-dom matchers)
│   ├── App.tsx
│   └── main.tsx                # Entry point with Amplify config
├── amplify_outputs.json        # Generated backend outputs
├── vite.config.ts
└── tsconfig.json
```

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
