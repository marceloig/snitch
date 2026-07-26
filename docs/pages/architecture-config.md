---
title: "Configuration & Project Layout"
layout: default
parent: Architecture
nav_order: 7
---

# Configuration & Project Layout
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Build-Time Environment Resolution

`amplify/synthEnv.ts` owns every value read from the environment at synth time. It is a pure leaf module — it imports nothing, not even `aws-cdk-lib` — so Vitest can exercise it with no side effects, and `backend.ts` and `cognitoAuth.ts` can both import it without the Cognito domain and callback URL ever diverging between the `amplify_outputs` custom block and the actual user pool. A divergence there would break OAuth's exact-match requirement.

The operator-facing table of what to set lives in [Setup → Environment Variables]({% link pages/setup.md %}#environment-variables). This section documents how the values are derived.

**`requireSynthEnv(env, name, fallback?)`** throws on a missing required value:

```
Environment variable IDC_SAML_METADATA_URL is required for synth-time Cognito config.
```

Failing loudly at synth is deliberate — the alternative is a stack that deploys and then can't authenticate anyone.

**`resolveCognitoDomainPrefix(env)`** tries four things in order:

1. `COGNITO_DOMAIN_PREFIX`, if set — the operator always wins.
2. `snitch-<branch>-<app-id>` from `AWS_BRANCH` and `AWS_APP_ID`. Stable per app and branch, so redeploys never replace `CfnUserPoolDomain`, and globally unique because app ids are.
3. `snitch-sandbox-<account-id>` from `CDK_DEFAULT_ACCOUNT`, which the CDK toolkit populates from deploy credentials. This is the sandbox analog of the previous rule: account ids are globally unique and stable, so a sandbox needs no explicit prefix.
4. Throw, with a message naming both the Amplify Hosting and sandbox routes.

**`sanitizeDomainPrefix(raw)`** forces any candidate into a valid Cognito domain: lowercase, `[a-z0-9-]` only, reserved words `aws`, `amazon`, and `cognito` stripped, no leading or trailing hyphen, 63 characters maximum. The reserved-word strip runs in a loop, because removing one occurrence can expose another across the seam — `aawss` collapses to `as` only on a second pass.

**`resolveAppCallbackUrl(env)`** takes `APP_CALLBACK_URL` if set, else `https://<branch>.<app-id>.amplifyapp.com`, else `http://localhost:5173`. No trailing slash; `notify.ts` appends `#/approve-requests` directly.

---

## Runtime Environment Variables

Every Lambda environment variable is injected by a setup module, never by `backend.ts` — with one exception, noted below.

| Variable | Injected by | Read by |
|---|---|---|
| `IDC_IDENTITY_STORE_ID` | `cognitoAuth.ts`, `slackHandler.ts` | `preTokenGeneration`, `slackInteractive`, the discovery Lambdas |
| `ADMIN_GROUP_ID`, `AUDITOR_GROUP_ID` | `cognitoAuth.ts` | `preTokenGeneration` |
| `AUTH_USER_POOL_ID` | `awsResourceFunctions.ts`, `slackHandler.ts` | `listCognitoUsers`, `slackInteractive` |
| `AVP_POLICY_STORE_ID` | `policyStore.ts`, `accessRequestHandlers.ts`, `slackHandler.ts` | Every AVP-touching handler |
| `PRIVILEGED_POLICY_TABLE_NAME` | `policyStore.ts` | Privileged policy CRUD, `evaluateAccess` |
| `APPROVAL_POLICY_TABLE_NAME` | `policyStore.ts` | `createApprovalPolicy`, `deleteApprovalPolicy` |
| `ACCESS_REQUEST_TABLE_NAME` | `accessRequestWorkflow.ts`, `accessRequestHandlers.ts`, `slackHandler.ts` | Every access-request handler |
| `ACCESS_REQUEST_STATE_MACHINE_ARN` | `accessRequestWorkflow.ts` | `requestAccess` |
| `APP_SETTINGS_TABLE_NAME` | `appSettings.ts`, `slackHandler.ts` | The seven settings readers |
| `NOTIFICATIONS_TOPIC_ARN` | `accessRequestWorkflow.ts`, `appSettings.ts` | The three notification publishers; read-only on `getSettings` |
| `APPSYNC_GRAPHQL_URL` | `accessRequestStatusStream.ts` | `publishRequestStatusChange` |
| `APPROVE_REQUEST_FUNCTION_ARN`, `REJECT_REQUEST_FUNCTION_ARN` | `slackHandler.ts` | `slackInteractive` |
| `APP_CALLBACK_URL` | `backend.ts` | `storeApprovalToken`, for the approval email link |

{: .note }
When a handler captures an environment variable at module scope (`const TABLE_NAME = process.env.X!`), a test must set it **before** the `await import(...)` that loads the module. Otherwise assertions on `cmd.input.TableName` silently receive `undefined`.

---

## Project Structure

```
snitch/
├── amplify/
│   ├── backend.ts                    # Orchestrator only — declares the backend and calls
│   │                                 # the eight setup modules. No IAM, no resources.
│   ├── synthEnv.ts                   # Build-time env resolution (pure, no imports)
│   ├── cognitoAuth.ts                # SAML provider, OAuth, managed login, pre-token grants
│   ├── awsResourceFunctions.ts       # IAM for the seven discovery Lambdas
│   ├── policyStore.ts                # Cedar schema, CfnPolicyStore, AVP + policy-table grants
│   ├── appSettings.ts                # AppSettingsTable + its readers' grants
│   ├── accessRequestHandlers.ts      # Grants for approve / reject / list / revoke
│   ├── accessRequestWorkflow.ts      # AccessRequestTable, SNS topic, state machine
│   ├── accessRequestStatusStream.ts  # DynamoDB stream → AppSync live updates
│   ├── slackHandler.ts               # Slack Function URL + its grants
│   ├── auth/resource.ts              # Cognito definition + pre-token trigger
│   ├── data/
│   │   ├── resource.ts               # The GraphQL contract: models, queries, mutations, subs
│   │   ├── subscriptionHandler.js     # Passthrough JS resolver for every subscription
│   │   └── publishStatusResolver.js   # Passthrough mutation resolver (NONE data source)
│   └── functions/
│       ├── auth/                     # preTokenGenerationHandler
│       ├── awsResources/             # Identity Center, Organizations, SSO Admin discovery
│       ├── verifiedPermissions/      # Cedar builders, policy CRUD, access evaluation
│       ├── accessRequests/           # Workflow Lambdas, approvals, audit, stream consumer
│       ├── notifications/notify.ts   # Shared best-effort Slack + SNS sender
│       ├── slackInteractions/        # Slack button callback handler
│       └── settings/                 # getSettings / updateSettings
├── src/
│   ├── App.tsx                       # Routes, navigation, and the route guards
│   ├── main.tsx                      # Amplify config + the sign-in redirect flow
│   ├── components/
│   │   ├── GroupGuard.tsx            # Renders children only for a given claim
│   │   ├── AdminGuard.tsx            # Thin wrapper over GroupGuard for "Admins"
│   │   ├── HelpPanelContext.tsx      # Shared Cloudscape help-panel plumbing
│   │   └── RequestDetailsModal.tsx   # Shared details + CloudTrail viewer
│   ├── pages/                        # Eight pages, one per route
│   ├── utils/
│   │   ├── duration.ts               # formatDuration, todayDateStr, minutes ↔ date+time
│   │   ├── accessRequestStatus.ts    # Status string → Cloudscape indicator type
│   │   ├── accessRequestRow.ts       # Flattened table projection of AccessRequestItem
│   │   └── formatDateTime.ts         # ISO → the viewer's local timezone and locale
│   └── test/                         # 32 test files + setup.ts
├── scripts/set-sandbox-env.example.sh
├── docs/                             # This site (Jekyll + just-the-docs)
├── amplify_outputs.json              # Generated backend outputs
└── vite.config.ts
```

Two directories that older versions of this page listed — `src/hooks/` and `src/types/` — do not exist. Shared types come from the generated `Schema` type in `amplify/data/resource.ts`.

---

## Tests

`src/test/` holds 32 test files plus `setup.ts`, run with Vitest and React Testing Library in a jsdom environment. Roughly a quarter are page and component suites; the rest cover Lambda handlers and the pure utility modules.

```bash
npm run test                                    # everything, once
npm run test:watch                              # watch mode
npm run test:coverage                           # with coverage
npx vitest run src/test/cedarPolicyBuilder.test.ts   # a single file
npx vitest run -t "conflict"                    # by test name
```

The pure modules — `synthEnv.ts`, both Cedar builders, `policyConflictChecker.ts`, `collectStatusChanges` — are the ones worth the most coverage, since they encode the rules everything else depends on.
