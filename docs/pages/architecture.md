---
title: Architecture
layout: default
nav_order: 10
---

# Architecture
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

Snitch is a fullstack AWS application built on Amplify Gen 2. The system relies on two complementary data stores — DynamoDB for application metadata and AWS Verified Permissions (AVP) for Cedar policy evaluation — and delegates access orchestration to Step Functions.

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│            React 19 + Cloudscape Design System          │
└────────────────────────┬────────────────────────────────┘
                         │ GraphQL (AppSync)
┌────────────────────────▼────────────────────────────────┐
│                     AWS AppSync                         │
│              GraphQL API (Cognito auth)                 │
└──┬──────────────┬────────────────────────────────┬──────┘
   │              │                                │
   ▼              ▼                                ▼
DynamoDB      Lambda Resolvers              Step Functions
(policy +     (CRUD, evaluation,            (JIT workflow)
 request       approval, audit)
 tables)
   │
   ▼
AWS Verified Permissions
(Cedar policy store — authoritative for all access decisions)

DynamoDB Streams (AccessRequestTable)
   │
   ▼
publishRequestStatusChange ──► AppSync subscription ──► Browser
(live status updates, see below)
```

---

## CDK Stack Layout

All infrastructure is defined in `amplify/` as CDK code and deployed via Amplify Gen 2.

| Stack | File | Owns |
|---|---|---|
| `auth` | `amplify/auth/resource.ts` + `amplify/backend.ts` (SAML section) | Cognito User Pool, managed login domain (`managedLoginVersion: 2`), `CfnManagedLoginBranding` (default Cognito style), SAML identity provider, app client OAuth config, pre-token generation Lambda |
| `data` | `amplify/data/resource.ts` + `amplify/backend.ts` | AppSync schema, Lambda resolvers, IAM grants, AVP policy store, `AppSettingsTable` |
| `AccessRequestWorkflow` | `amplify/accessRequestWorkflow.ts` | `AccessRequestTable`, Step Functions state machine, workflow Lambdas |

### Why Two Stacks?

AppSync resolvers reference Lambda ARNs. If approval/revocation Lambdas lived inside `AccessRequestWorkflow`, a circular dependency would form:

- `data` → `AccessRequestWorkflow` (AppSync references Lambda ARNs)
- `AccessRequestWorkflow` → `data` (needs `PrivilegedPolicyTable` ARN for IAM)

The split breaks the cycle: `AccessRequestWorkflow` exposes `{ accessRequestTableArn, accessRequestTableName, accessRequestTableStreamArn, notificationsTopicArn }` and `data` (`backend.ts`) imports them — a single direction CloudFormation can resolve.

---

## Two Data Stores, One Source of Truth

Every `PrivilegedPolicy` and `ApprovalPolicy` record exists in:

1. **DynamoDB** — application metadata (policy details, foreign key `avpPolicyId`)
2. **AWS Verified Permissions** — the Cedar policy (authoritative for access decisions)

DynamoDB stores the `avpPolicyId` returned by AVP, which is the handle used for subsequent deletes. AVP is never queried for metadata — only for authorization decisions via `IsAuthorized`.

### Compensating Transactions

| Mutation | Write Order | Rollback Target |
|---|---|---|
| Create (policy or approval) | AVP first → DynamoDB | Delete AVP policy |
| Update (privileged policy only) | DynamoDB first → AVP | Restore DynamoDB snapshot |
| Delete (both types) | DynamoDB first → AVP | Restore DynamoDB snapshot |

This ordering ensures that on partial failure, the rollback target is always reachable.

---

## IAM Permission Wiring

All IAM `PolicyStatement` additions live in `amplify/backend.ts`. Lambda functions carry no inline IAM config. When a `is not authorized to perform` error surfaces, `backend.ts` is always the first file to inspect.

---

## Request Handler Placement: `data` vs `AccessRequestWorkflow`

| Rule | Location |
|---|---|
| Handler called directly by AppSync (query/mutation) | `resourceGroupName: "data"` |
| Handler called by the Step Functions state machine | `resourceGroupName: "AccessRequestWorkflow"` |
| Handler that *calls* AppSync (needs the GraphQL endpoint) | `resourceGroupName: "data"` |

### Current Split

| `data` stack | `AccessRequestWorkflow` stack |
|---|---|
| `requestAccess`, `listAccessRequests` | `storeApprovalToken`, `storeActiveToken` |
| `approveRequest`, `rejectRequest`, `listPendingApprovals` | `assignPermissionSet`, `removePermissionSet`, `setStatusFailed` |
| `listAllAccessRequests`, `revokeAccess` | |
| `createApprovalPolicy`, `deleteApprovalPolicy` | |
| `getSettings`, `updateSettings`, `getCloudTrailLogs` | |
| `publishRequestStatusChange` (DynamoDB stream consumer) | |

---

## Live Status Updates

Request tables in the UI update themselves — no polling, no manual refresh. The mechanism has two halves, because AppSync subscriptions can only be linked to a mutation (`.for(a.ref("<mutation>"))`) and therefore only fire when a **client** calls that mutation:

1. **Client-driven changes** are broadcast by the mutation itself: `onAccessRequestCreated`, `onAccessRequestApproved`, `onAccessRequestRejected`, `onAccessRequestRevoked`.
2. **Workflow-driven changes** have no client mutation to hook into — natural expiry and revocation are written by `removePermissionSetHandler` seconds *after* `revokeAccess` returns, the 24-hour approval timeout (`SetStatusExpired`) and `SetStatusScheduled` are Step Functions DynamoDB SDK integrations with no Lambda at all, and `FAILED` comes from `setStatusFailedHandler`. A DynamoDB stream on `AccessRequestTable` is the one channel that observes all of them.

```
AccessRequestTable (stream: NEW_AND_OLD_IMAGES)
  └─ EventSourceMapping (filter eventName = MODIFY, batch 10, 1s window)
       └─ publishRequestStatusChange  [data stack]
            └─ mutation publishAccessRequestStatus  (passthrough resolver, NONE data source)
                 └─ subscription onAccessRequestStatusChanged
                      └─ Elevated Access, Approval History, Session Activity → refetch
```

Wired in `amplify/accessRequestStatusStream.ts`. Design points:

- **The consumer belongs to the `data` stack.** It needs the stream ARN (from `AccessRequestWorkflow`) *and* the GraphQL endpoint (from `data`); placing it in `data` keeps both references pointing `data → AccessRequestWorkflow`. Only the stream **ARN** crosses stacks, never the `Table` construct.
- **Authorization is IAM.** Amplify always configures the API with `enableIamAuthorizationMode`, and IAM principals bypass `@auth` rules — so the publisher is authorized purely by an `appsync:GraphQL` grant scoped to the single `publishAccessRequestStatus` field.
- **The event payload is deliberately thin** (`requestId`, `status`, `updatedAt`). Subscribers react by refetching through their own authorized query, so no requester email, account, or justification ever travels over a subscription.
- **The consumer never throws.** A throw would retry the whole batch and stall the stream shard. It also skips records whose status did not change — most writes to the table only touch `taskToken`, `revokeComment`, or timestamps.
- **Push is best-effort.** Pages still load on mount and offer Refresh; the subscription is an optimization, never the only path to correct data.

---

## AppSync Identity Model

AppSync forwards the Cognito **access token** to Lambda resolvers — not the ID token. The access token only contains `sub`, `cognito:groups`, and standard OIDC fields. Custom attributes such as `email` are absent.

### Federated Username Format

For SAML-federated users (IDC), Cognito formats the username as:

```
<providerName>_<samlNameId>
```

The provider name is `IDC` (stored lowercase), and the NameID is the user's email (as configured in the IDC attribute mapping). So the username for `alice@example.com` is `idc_alice@example.com`.

Lambda handlers that need the user's email extract it from `event.identity.username`:

```typescript
const IDC_USERNAME_PREFIX = "idc_";
const email = username.startsWith(IDC_USERNAME_PREFIX)
  ? username.slice(IDC_USERNAME_PREFIX.length)
  : undefined;
```

This pattern is implemented in `getMyIDCUserHandler.ts`. Other handlers that need to identify the caller should follow the same approach rather than reading `event.identity.claims["email"]`, which is never present in the access token.

---

## Project Structure

```
snitch/
├── amplify/
│   ├── auth/resource.ts              # Cognito — SAML federation + pre-token generation trigger
│   ├── authConfig.ts                 # REMOVED — synth-time Cognito values now come directly from environment variables
│   ├── data/resource.ts              # AppSync schema: models + custom resolvers
│   ├── backend.ts                    # CDK wiring: SAML/OAuth escape hatch, managed login
│   │                                 # branding, AVP policy store, IAM grants, env vars
│   ├── accessRequestWorkflow.ts      # Step Functions state machine + AccessRequestTable
│   ├── accessRequestStatusStream.ts  # DynamoDB stream → AppSync live status updates
│   └── functions/
│       ├── auth/                     # Pre-token generation Lambda (injects IDC groups)
│       ├── awsResources/             # Lambda resolvers: IDC, Organizations, SSO Admin
│       ├── settings/                 # getSettings / updateSettings handlers
│       ├── verifiedPermissions/      # Cedar policy CRUD + access evaluation
│       └── accessRequests/           # JIT workflow Lambdas + approval handlers
├── src/
│   ├── components/                   # Reusable UI components
│   ├── hooks/                        # Custom React hooks
│   ├── utils/
│   │   ├── duration.ts               # formatDuration, todayDateStr, minutesToMaxDuration
│   │   └── accessRequestStatus.ts    # accessRequestStatusType — status → Cloudscape indicator
│   ├── types/                        # Shared TypeScript types
│   └── pages/                        # Page-level components (one per route)
├── amplify_outputs.json              # Generated backend outputs (gitignored in prod)
└── vite.config.ts
```
