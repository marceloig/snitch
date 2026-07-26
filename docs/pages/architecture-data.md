---
title: "Data Model & Storage"
layout: default
parent: Architecture
nav_order: 2
---

# Data Model & Storage
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Two Data Stores, One Source of Truth

Every `PrivilegedPolicy` and `ApprovalPolicy` record exists twice:

1. **DynamoDB** holds the application record — the display names, timestamps, and the `avpPolicyId` foreign key.
2. **AWS Verified Permissions** holds the Cedar policy, and is authoritative for every access decision.

AVP is never queried for metadata, only for decisions through `IsAuthorized`. DynamoDB is never consulted to decide whether access is allowed. Keeping those two jobs apart is what makes it impossible for an application bug to grant access that policy doesn't permit.

The `avpPolicyId` DynamoDB stores is the handle used to update or delete the Cedar policy later.

---

## Compensating Transactions

Writing to two stores without distributed transactions means one of them can succeed while the other fails. The write order is chosen per operation so that the thing you'd need to roll back is always still reachable.

| Operation | Write order | Rollback on failure |
|---|---|---|
| Create (privileged or approval policy) | AVP first → DynamoDB | Delete the AVP policy |
| Update (privileged policy only) | DynamoDB first → AVP | Restore the DynamoDB snapshot |
| Delete (privileged or approval policy) | DynamoDB first → AVP | Restore the DynamoDB snapshot |

Creates go to AVP first because a Cedar policy with no DynamoDB record is invisible to the UI but harmless, and its id is in hand to delete. Updates and deletes go to DynamoDB first because the handler needs the old item in memory to restore it, and reading it back after a failed AVP call would be racy.

Approval policies have no update path at all — the UI deletes and recreates, which sidesteps the problem.

---

## Tables

| Table | Keys | Stack |
|---|---|---|
| `PrivilegedPolicy` | `id` | `data/amplifyDataPrivilegedPolicy` |
| `ApprovalPolicy` | `accountId` (partition) + `principalKey` (sort) | `data/amplifyDataApprovalPolicy` |
| `AccessRequestTable` | `id` | `AccessRequestWorkflow` |
| `AppSettingsTable` | `settingKey` | `AppSettingsStack` |

The first two are Amplify models declared in `amplify/data/resource.ts`; the last two are CDK `Table` constructs, both `PAY_PER_REQUEST` with `RemovalPolicy.RETAIN`.

`ApprovalPolicy`'s composite key is deliberate. `principalKey` is `"${principalType}#${principalId}"`, so the pair `(accountId, principalKey)` uniquely identifies one approver on one account. That turns the duplicate check into a single `GetItem` — no secondary index, no scan.

---

## AccessRequestTable Indexes and Stream

**Index** — `byIdcUserId`, partitioned on `idcUserId` with no sort key. `listAccessRequests` uses it to return one user's history without scanning the table. Admin and auditor views call `listAllAccessRequests`, which does scan, since they need every record regardless of owner.

**Stream** — `StreamViewType.NEW_AND_OLD_IMAGES`.

Both images are required, not just the new one. Most writes to this table don't change `status` — they store or clear a task token, attach a revoke comment, or stamp a timestamp. The stream consumer compares the old and new `status` and drops the record when they match, which is what keeps a busy workflow from firing a subscription event on every incidental write. With `NEW_IMAGE` alone there would be nothing to compare against.

The consumer itself is covered in [GraphQL API & Live Updates]({% link pages/architecture-api.md %}#live-status-updates).

---

## App Settings — a Single-Record Table

`AppSettingsTable` holds exactly one item, keyed `settingKey: "global"`. There is no list operation and no pagination; `getAppSettings` and `updateAppSettings` both address that one item directly.

Stored fields:

| Field | Set from |
|---|---|
| `cloudTrailLogGroupName` | Settings → CloudTrail Audit Logs |
| `slackBotToken`, `slackChannelId`, `slackSigningSecret` | Settings → Slack Integration |
| `slackNotificationsEnabled`, `snsNotificationsEnabled`, `snsApprovalNotificationsEnabled` | Settings → Access-Request Notifications |

`updateSettingsHandler` performs a **partial** update: arguments that arrive as `null` or `undefined` are skipped, while an explicit `""` or `false` is written. That's what lets the UI save one card without clearing the other two.

`getSettings` also returns `snsTopicArn`, which is **not** in the table — it comes from the `NOTIFICATIONS_TOPIC_ARN` environment variable and is read-only in the UI.

Seven Lambdas read this record: `getSettings`, `updateSettings`, `getCloudTrailLogs`, `storeApprovalToken`, `requestAccess`, `removePermissionSet`, and `slackInteractive`. The grants are in `amplify/appSettings.ts` and `amplify/slackHandler.ts`.
