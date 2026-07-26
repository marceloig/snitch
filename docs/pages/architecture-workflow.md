---
title: Access Request Workflow
layout: default
parent: Architecture
nav_order: 4
---

# Access Request Workflow
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## State Machine Overview

`amplify/accessRequestWorkflow.ts` defines a Step Functions state machine with eleven states. `requestAccessHandler` persists the record and starts an execution; everything after that is the state machine's job.

```
CheckApproval (Choice)
 ├─ requiresApproval ─► WaitForApproval ──┬─ approved ──► CheckStartTime
 │                                        ├─ rejected ──► RejectionHandled  (end)
 │                                        ├─ 24h heartbeat ─► SetStatusExpired  (end)
 │                                        └─ error ─────► SetStatusFailed  (end)
 └─ default ───────────────────────────────────────────► CheckStartTime

CheckStartTime (Choice)
 ├─ startTime present ─► SetStatusScheduled ─► WaitUntilStartTime ─┐
 └─ default ───────────────────────────────────────────────────────┤
                                                                   ▼
                                                        AssignPermissionSet
                                                                   │
                                                                   ▼
                                                        WaitForEarlyRevocation
                                          ┌────────────────────────┴────────────┐
                              States.Timeout (natural expiry)      SendTaskSuccess (admin revoke)
                                          └────────────┬───────────────────────┘
                                                       ▼
                                             RemovePermissionSet  (end)
```

---

## The Approval Gate

`CheckApproval` is a Choice state on `$.requiresApproval`. When false — the common case — it goes straight to `CheckStartTime` and the rest of this section never runs.

When true, `WaitForApproval` invokes `storeApprovalToken` through `arn:aws:states:::lambda:invoke.waitForTaskToken`, passing `$$.Task.Token` in the payload. The handler writes that token to the request record and sets the status to `PENDING_APPROVAL`. The execution then sits still until someone calls back with it.

Three things can end the wait:

| Catch | Goes to | Why |
|---|---|---|
| `States.HeartbeatTimeout` | `SetStatusExpired` | Nobody acted within the deadline |
| `RequestRejected` | `RejectionHandled` | An approver rejected it |
| `States.ALL` | `SetStatusFailed` | Anything else |

{: .note }
The 24-hour deadline is `HeartbeatSeconds: 86400`, not a task timeout. Nothing sends heartbeats, so the effect is the same — but it appears in execution history as `States.HeartbeatTimeout`, which is the error the catch is written against.

`RejectionHandled` is a `Pass` state that does nothing. It exists because `rejectRequestHandler` has already written `REJECTED` to DynamoDB before calling `SendTaskFailure`; the execution just needs somewhere to terminate cleanly.

`SetStatusExpired` is an `aws-sdk:dynamodb:updateItem` integration rather than a Lambda. It only needs `$.requestId` from the execution input and `$$.State.EnteredTime` for the timestamp, so a Lambda cold start would buy nothing. It sets the status and removes the now-useless task token in one write.

---

## Scheduled Start

`CheckStartTime` guards on `startTime` being both present and non-null. When it is, `SetStatusScheduled` — another DynamoDB integration, with `ResultPath: null` so it doesn't clobber the execution input — marks the request `SCHEDULED`, and `WaitUntilStartTime` waits with `TimestampPath: "$.startTime"`.

Without a start time, both states are skipped and the request activates immediately.

---

## Assignment and Revocation

`AssignPermissionSet` invokes its Lambda with `OutputPath: "$.Payload"`. The handler creates the SSO account assignment, sets the status to `ACTIVE`, and stamps `activatedAt`.

`WaitForEarlyRevocation` is the state that makes early revocation possible. It's a second `waitForTaskToken` task, this time against `storeActiveToken`, carrying **`TimeoutSecondsPath: "$.durationSeconds"`**. That single field does the work of the old plain `Wait` state while leaving the execution interruptible:

- **Natural expiry** — after `durationSeconds` the state raises `States.Timeout`, which is caught to `RemovePermissionSet` with `ResultPath: null` so the original input survives. No `revokedByAdmin` flag is present, so the handler writes `EXPIRED`.
- **Admin revocation** — `revokeAccessHandler` calls `SendTaskSuccess` with `revokedByAdmin: true` in the output. The execution moves to `RemovePermissionSet` immediately and the handler writes `REVOKED`.

Either way `RemovePermissionSet` deletes the account assignment, stamps `deactivatedAt`, and sends the "access finished" notification. It's the terminal state on the happy path.

---

## Failure Handling and Retries

`AssignPermissionSet`, `RemovePermissionSet`, and `SetStatusFailed` share a retry policy for transient Lambda faults:

```
ErrorEquals:     Lambda.ServiceException, Lambda.AWSLambdaException,
                 Lambda.SdkClientException, Lambda.TooManyRequestsException
IntervalSeconds: 2
MaxAttempts:     3
BackoffRate:     2
JitterStrategy:  FULL
```

Anything the retries don't absorb is caught by `States.ALL` and routed to `SetStatusFailed`, which writes `FAILED`. A request in that state has had no permission set assigned, or has had one assigned that couldn't be removed — the second case is the one worth alerting on.

The state machine's role carries two inline policies, both narrowly scoped: `lambda:InvokeFunction` on exactly the five Lambdas it calls, and `dynamodb:UpdateItem` on `AccessRequestTable` for the two direct-integration states.
