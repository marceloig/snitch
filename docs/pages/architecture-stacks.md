---
title: "Stacks & Lambda Placement"
layout: default
parent: Architecture
nav_order: 1
---

# Stacks & Lambda Placement
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Stack Layout

All infrastructure is CDK code under `amplify/`, deployed through Amplify Gen 2. It synthesizes into five stacks — not the three you might expect from the `resourceGroupName` values alone.

| Stack | Defined in | Owns |
|---|---|---|
| `auth` | `amplify/auth/resource.ts` + `amplify/cognitoAuth.ts` | Cognito user pool, the SAML identity provider, the managed login domain (`managedLoginVersion: 2`) and its branding, the app client's OAuth config, and the pre-token-generation Lambda |
| `data` | `amplify/data/resource.ts` + several sibling modules | AppSync API and schema, 16 Lambdas, the Slack Function URL |
| `AccessRequestWorkflow` | `amplify/accessRequestWorkflow.ts` | `AccessRequestTable` with its index and stream, the SNS notifications topic, the state machine and its role, 7 Lambdas |
| `AppSettingsStack` | `backend.createStack("AppSettingsStack")` in `backend.ts`, wired by `amplify/appSettings.ts` | `AppSettingsTable` and the grants that let six Lambdas read it |
| `function` (Amplify's default group) | `amplify/functions/awsResources/resource.ts` | The 7 discovery Lambdas, which declare no `resourceGroupName` and therefore land in Amplify's default function stack |

{: .note }
The Verified Permissions policy store is **not** in `data` directly. `setupPolicyStore` constructs `CfnPolicyStore` with the `PrivilegedPolicy` table as its CDK scope (`amplify/policyStore.ts`), so it synthesizes into the `data/amplifyDataPrivilegedPolicy` child stack. Worth knowing when you go looking for it in CloudFormation.

---

## Why the data / AccessRequestWorkflow Split

AppSync must reference the ARN of every Lambda that resolves a field. If the approval and revocation Lambdas lived in `AccessRequestWorkflow`, the dependency graph would close on itself:

- `data` → `AccessRequestWorkflow`, because AppSync references those Lambda ARNs, **and**
- `AccessRequestWorkflow` → `data`, because the workflow needs the `PrivilegedPolicy` table ARN for its IAM grants.

CloudFormation can't resolve that. The split breaks it: `setupAccessRequestWorkflow()` returns `{ accessRequestTableArn, accessRequestTableName, accessRequestTableStreamArn, notificationsTopicArn }`, and `backend.ts` passes those values into the `data`-side modules. Every reference then points one way, `data → AccessRequestWorkflow`.

{: .important }
Only **ARNs and names** may cross a stack boundary — never a `Table` or `Function` construct. Passing a construct re-creates the cycle through CDK's automatic dependency tracking, and the failure surfaces at synth time as an opaque cyclic-reference error.

---

## Choosing a Stack for a New Handler

| If the handler is… | Put it in |
|---|---|
| Invoked by AppSync as a query or mutation resolver | `data` |
| Invoked by the Step Functions state machine | `AccessRequestWorkflow` |
| Something that *calls* AppSync and needs the GraphQL endpoint | `data` |
| Something that needs another `data` Lambda's ARN | `data` |

The last row is why `slackInteractive` sits in `data` even though it isn't an AppSync resolver — it invokes `approveRequest` and `rejectRequest` directly and needs their ARNs.

---

## Lambda Inventory

Thirty-one Lambdas across four stacks.

**`auth` — 1**

`preTokenGeneration`

**`data` — 16**

| Group | Functions |
|---|---|
| Policy CRUD | `createPrivilegedPolicy`, `updatePrivilegedPolicy`, `deletePrivilegedPolicy`, `createApprovalPolicy`, `deleteApprovalPolicy` |
| Access evaluation | `evaluateAccess` |
| Approvals | `approveRequest`, `rejectRequest`, `listPendingApprovals` |
| Admin & audit | `listAllAccessRequests`, `revokeAccess`, `getCloudTrailLogs` |
| Settings | `getSettings`, `updateSettings` |
| Integrations | `publishRequestStatusChange`, `slackInteractive` |

**`AccessRequestWorkflow` — 7**

`requestAccess`, `listAccessRequests`, `assignPermissionSet`, `removePermissionSet`, `setStatusFailed`, `storeApprovalToken`, `storeActiveToken`

**`function` — 7**

`getMyIDCUser`, `listIDCUsers`, `listIDCGroups`, `listAWSAccounts`, `listOUs`, `listPermissionSets`, `listCognitoUsers`

{: .note }
Two placements are easy to guess wrong. `requestAccess` and `listAccessRequests` are AppSync resolvers, but they live in **`AccessRequestWorkflow`** — `requestAccess` starts the state machine and needs its ARN, and `listAccessRequests` reads the workflow's table. Conversely `slackInteractive` is not an AppSync resolver but lives in **`data`**.

---

## IAM Permission Wiring

`amplify/backend.ts` contains **no** `PolicyStatement` at all. It is a 190-line orchestrator: it declares the backend, then calls eight setup modules and threads the returned ARNs between them. Every grant lives in one of those modules.

| Module | Grants |
|---|---|
| `cognitoAuth.ts` | `identitystore:*` reads for the pre-token Lambda; SAML provider, OAuth, and managed-login configuration |
| `awsResourceFunctions.ts` | `sso:*`, `identitystore:*`, `organizations:*` for the six discovery Lambdas; `cognito-idp:ListUsers` for `listCognitoUsers` |
| `policyStore.ts` | Creates the policy store; AVP create/update/delete and `IsAuthorized`; DynamoDB access to the `PrivilegedPolicy` and `ApprovalPolicy` tables |
| `appSettings.ts` | Creates `AppSettingsTable`; `GetItem`/`UpdateItem` for the settings pair, `GetItem` for four readers, and `logs:FilterLogEvents` for `getCloudTrailLogs` |
| `accessRequestHandlers.ts` | DynamoDB access to `AccessRequestTable`, AVP `IsAuthorized`, and `states:SendTaskSuccess` / `SendTaskFailure` for the approval and revocation Lambdas |
| `accessRequestStatusStream.ts` | Stream read permissions, the field-scoped `appsync:GraphQL` grant, and the event source mapping |
| `slackHandler.ts` | The Function URL; DynamoDB reads, `cognito-idp:ListUsers`, `identitystore:*`, AVP `IsAuthorized`, and `lambda:InvokeFunction` on the two approval Lambdas |
| `accessRequestWorkflow.ts` | The table, index, stream, SNS topic, state machine role, and every workflow Lambda's grants and environment |

{: .important }
When a deployment fails with `is not authorized to perform`, find the module that owns the Lambda in the table above — not `backend.ts`. It has nothing to tell you.

`logs:FilterLogEvents` and a handful of `identitystore` / `organizations` reads are scoped to `*` because their targets are runtime-determined (the log group name is admin-configured; Identity Center list operations don't support resource-level permissions). Everything else is scoped to a specific ARN.
