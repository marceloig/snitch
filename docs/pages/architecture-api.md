---
title: "GraphQL API & Live Updates"
layout: default
parent: Architecture
nav_order: 3
---

# GraphQL API & Live Updates
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Schema Surface

`amplify/data/resource.ts` is the contract for the whole API: 2 models, 13 queries, 11 mutations, and 10 subscriptions. The default authorization mode is the Cognito user pool.

Adding a Lambda-backed operation takes four steps: define the function in a `resource.ts`, declare the operation here, register the function in `backend.ts`, and add its IAM grants in the appropriate setup module.

{: .note }
Amplify always also enables IAM authorization on the API. IAM principals bypass `@auth` rules entirely, which is what lets the stream consumer call a mutation marked `allow.group("Admins")` — see [Live Status Updates](#live-status-updates).

---

## Queries

| Query | Authorization |
|---|---|
| `getMyIDCUser` | Any signed-in user |
| `evaluateMyAccess` | Any signed-in user |
| `listMyAccessRequests` | Any signed-in user |
| `listAWSAccounts` | Any signed-in user |
| `listPendingApprovals` | Any signed-in user |
| `listIDCUsers`, `listIDCGroups`, `listOUs`, `listPermissionSets`, `listCognitoUsers` | `Admins` |
| `getAppSettings` | `Admins` |
| `listAllAccessRequests` | `Admins` + `Auditors` |
| `getCloudTrailLogs` | `Admins` + `Auditors` |

Two of these are broader than they first look and are worth understanding.

`listPendingApprovals` is open to any signed-in user because approvers are not necessarily admins. The handler is the enforcement point: it scans for `PENDING_APPROVAL` requests, then calls AVP `IsAuthorized` once per unique `(accountId, permissionSetArn)` pair and returns only what the caller may act on. A user with no approval policy gets an empty list.

`listAWSAccounts` is open so the Request Access dropdown can resolve account names for non-admins. It returns every account in the organization, but names only reach the dropdown for accounts `evaluateMyAccess` already permitted — so there's no access expansion, at the cost of letting any signed-in user enumerate account names by calling the query directly.

---

## Mutations

| Mutation | Authorization |
|---|---|
| `requestAccess`, `approveRequest`, `rejectRequest` | Any signed-in user |
| `createPrivilegedPolicyWithAVP`, `updatePrivilegedPolicyWithAVP`, `deletePrivilegedPolicyWithAVP` | `Admins` |
| `createApprovalPolicyWithAVP`, `deleteApprovalPolicyWithAVP` | `Admins` |
| `revokeAccess` | `Admins` |
| `updateAppSettings` | `Admins` |
| `publishAccessRequestStatus` | `Admins` (IAM principals bypass this) |

`approveRequest` and `rejectRequest` follow the same pattern as `listPendingApprovals`: open at the schema level, authorized in the handler through AVP. Both also refuse self-approval by comparing the caller's `event.identity.username` against the `requesterCognitoSub` stored on the record when it was created.

---

## Subscriptions

All ten are backed by the same passthrough resolver, `subscriptionHandler.js`.

| Subscription | Fires on | Authorization |
|---|---|---|
| `onPrivilegedPolicyCreated` / `Updated` / `Deleted` | The three privileged-policy mutations | `Admins` |
| `onApprovalPolicyCreated` / `Deleted` | The two approval-policy mutations | `Admins` |
| `onAccessRequestCreated` | `requestAccess` | Any signed-in user |
| `onAccessRequestApproved` | `approveRequest` | Any signed-in user |
| `onAccessRequestRejected` | `rejectRequest` | Any signed-in user |
| `onAccessRequestRevoked` | `revokeAccess` | `Admins` |
| `onAccessRequestStatusChanged` | `publishAccessRequestStatus` | `Admins` + `Auditors` |

That last row is what lets the two auditor pages update live without granting them anything else.

---

## Live Status Updates

Request tables in the UI keep themselves current with no polling. The mechanism has two halves, because an AppSync subscription can only be bound to a mutation with `.for(a.ref("<mutation>"))` — so it fires only when a **client** calls that mutation.

**Client-driven changes** broadcast themselves. A user submits a request, an approver decides, an admin revokes: each is a client mutation, and the four `onAccessRequest*` subscriptions above cover them.

**Workflow-driven changes have no client mutation to hook into.** There are four of them, and none can use the mechanism above:

- Natural expiry and the completion of an admin revocation are both written by `removePermissionSetHandler`, seconds *after* `revokeAccess` has already returned to the caller.
- The 24-hour approval timeout (`SetStatusExpired`) and the scheduled-start transition (`SetStatusScheduled`) are Step Functions DynamoDB integrations with no Lambda involved at all.
- `FAILED` comes from `setStatusFailedHandler`.

A DynamoDB stream on `AccessRequestTable` is the one channel that observes all of them.

```
AccessRequestTable  (stream: NEW_AND_OLD_IMAGES)
  └─ EventSourceMapping  (filter eventName = MODIFY, batch 10, 1s window, 1 retry)
       └─ publishRequestStatusChange           [data stack]
            └─ mutation publishAccessRequestStatus   (NONE data source)
                 └─ subscription onAccessRequestStatusChanged
                      └─ Elevated Access · Approval History · Session Activity → refetch
```

Wired in `amplify/accessRequestStatusStream.ts`. Five design points are load-bearing:

**The consumer must be in the `data` stack.** It needs the stream ARN, which comes from `AccessRequestWorkflow`, *and* the GraphQL endpoint, which comes from `data`. Placed in `data`, both references point `data → AccessRequestWorkflow`. Placed in the workflow stack, they'd close the cycle.

**Authorization is IAM, not `@auth`.** `allow.resource()` doesn't exist for custom operations, but Amplify always enables IAM authorization mode and IAM principals bypass `@auth` rules. So the publisher is authorized purely by an `appsync:GraphQL` grant scoped to a single field, `…/types/Mutation/fields/publishAccessRequestStatus` — narrower than Amplify's own schema-level `types/Mutation/*` grant. The `allow.group("Admins")` rule on the mutation is the user-pool-side restriction; a spoofed call from a client only makes subscribers refetch, and the refetch reads the real record.

**The payload is deliberately thin** — `requestId`, `status`, `updatedAt`, nothing else. Subscribers react by refetching through their own authorized query, so no requester email, account, or justification ever travels over a subscription. That's also what would make it safe to expose an `allow.authenticated()` variant to end users on the Request Access page.

**The handler never throws.** A throw would retry the whole batch and stall the shard. `collectStatusChanges` — exported and unit-tested — drops records whose status didn't change and keeps only the newest status per `requestId` within a batch.

**Push is best-effort.** Every page still loads on mount and offers Refresh; the subscription is an optimization, never the only path to correct data. The Elevated Access page additionally keeps an optimistic *Revoked* overlay for the second or two between the mutation and the real write, clearing each id as soon as a refetch reports a terminal status.
