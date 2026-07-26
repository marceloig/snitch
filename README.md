# Snitch

Snitch is a **Just-in-Time (JIT) privileged access management** tool for AWS accounts. Administrators define rules that let IAM Identity Center users or groups request access to specific AWS accounts with a chosen Permission Set. Users request temporary, time-limited access through a self-service UI; access is granted automatically and revoked when the duration expires.

Nobody holds standing access. Permission to *ask* is permanent; the access itself never is.

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, [Cloudscape Design System](https://cloudscape.design/)
- **Backend**: AWS Amplify Gen 2 — AppSync (GraphQL), DynamoDB, Cognito, Lambda
- **Authorization**: AWS Verified Permissions (Cedar policy language)
- **Access orchestration**: AWS Step Functions + AWS SSO Admin API
- **Testing**: Vitest, React Testing Library

---

## Documentation

Full documentation lives in [`docs/`](docs/) and is published to GitHub Pages on every push to `main`.

| Guide | Covers |
|---|---|
| [Setup](docs/pages/setup.md) | Prerequisites and the canonical environment-variable reference |
| [Getting Started](docs/pages/getting-started.md) | Production deployment, start to finish |
| [Sandbox Deployment](docs/pages/sandbox-deployment.md) | Running the whole stack locally |
| [CloudTrail Setup](docs/pages/cloudtrail-setup.md) | Turning on the session audit trail |
| [Slack Setup](docs/pages/slack-setup.md) | Notifications and one-click approvals |
| [Concepts & Glossary](docs/pages/concepts.md) | Every term used across the docs, defined once |
| [Architecture](docs/pages/architecture.md) | Stacks, data model, API, workflow, authorization, integrations |

The sections below are a condensed overview. Where this README and the docs differ in detail, the docs are canonical.

---

## Features

### 1. Authentication & Authorization

Users sign in with their **IAM Identity Center (IDC)** credentials — no separate password. IDC is the identity provider; Cognito issues the session tokens. Admin and auditor pages are gated by membership in designated IDC groups, keyed on the immutable **GroupId** so renaming a group never breaks access. Access decisions are evaluated against Cedar policies in AWS Verified Permissions, not hardcoded rules.

### 2. Privileged Policies

Admins define who can request what. Each policy maps an IDC user or group to one or more AWS accounts (or entire OUs) and a specific Permission Set, with a maximum duration. Policies can be created, updated, and deleted from the UI; changes take effect on the next access request. See [Privileged Policies](docs/pages/privileged-policies.md).

### 3. Just-in-Time Access Requests

Users see only the accounts and permission sets they're permitted to request. They pick a destination, choose when the access should end, and submit. Access is granted automatically and revoked when the duration elapses — no manual cleanup. See [Access Requests](docs/pages/access-requests.md).

### 4. Approval Workflow

A policy can require sign-off before access is granted. Admins configure which users or groups may approve requests for each AWS account, limited to chosen permission sets. Approvers see only the requests they're authorized to act on, and nobody can approve their own request. Unanswered requests expire after 24 hours. See [Approval Workflow](docs/pages/approval-workflow.md).

### 5. Elevated Access (Admin)

Admins can view every request across all users, revoke live access early with an optional comment, and inspect the audit trail for each access window. See [Elevated Access](docs/pages/elevated-access.md).

Request tables update themselves in near real time — including status changes written by the workflow rather than by a user, such as a session expiring on its own or the 24-hour approval timeout. A DynamoDB stream on the request table republishes every status transition over an AppSync subscription, so the admin and auditor pages never poll. See [Architecture → GraphQL API & Live Updates](docs/pages/architecture-api.md#live-status-updates).

### 6. Auditor Pages (Read-Only)

Members of the auditor group get two read-only views and no ability to change anything: **Approval History**, every approval-required request and how it was decided, and **Session Activity**, every session that actually granted access plus the AWS activity recorded during it. Auditor and admin membership are independent. See [Auditor Features](docs/pages/auditor-features.md).

### 7. AWS Resource Discovery

When building policies, admins browse live data from the connected AWS organization — IDC users and groups, AWS accounts, Organizational Units, and Permission Sets — without leaving the app. Nothing is imported or kept in sync by hand.

### 8. Notifications

Snitch announces the access-request lifecycle over **Slack** and **Amazon SNS**, with per-channel toggles in Settings. Notifications fire when access is **requested**, when a session **finishes** (expires or is revoked), and when a request **needs approval**. Slack approval messages carry Approve/Reject buttons; the SNS approval email links back to the in-app Approve Requests page, because an email recipient can't be securely identified. See [Settings → Notifications](docs/pages/settings.md#notifications).

> Slack's interactive buttons need the Lambda Function URL pasted into the Slack app's **Interactivity & Shortcuts → Request URL**. Skip that and messages still arrive but the buttons do nothing. The URL is not a deployment output — [Slack Setup](docs/pages/slack-setup.md#step-6--find-the-snitch-slack-endpoint) covers how to find it.

---

## Project Structure

```
amplify/               # Backend infrastructure (CDK) and Lambda functions
├── backend.ts         # Orchestrator — declares the backend, calls the setup modules
├── synthEnv.ts        # Build-time environment resolution (pure, no imports)
├── cognitoAuth.ts     # SAML provider, OAuth, managed login
├── policyStore.ts     # Cedar schema, policy store, AVP grants
├── appSettings.ts     # App settings table and its readers
├── accessRequest*.ts  # Workflow, approval handlers, live-update stream
├── slackHandler.ts    # Slack Function URL and its grants
├── auth/              # Cognito definition and sign-in trigger
├── data/              # GraphQL schema and JS resolvers
└── functions/         # Lambda handlers grouped by domain
    ├── auth/                 # Pre-token generation (injects group claims)
    ├── awsResources/         # Discovery: accounts, OUs, IDC users/groups, permission sets
    ├── verifiedPermissions/  # Cedar builders, policy CRUD, access evaluation
    ├── accessRequests/       # Request lifecycle, approvals, audit, stream consumer
    ├── slackInteractions/    # Slack button callback handler
    ├── notifications/        # Shared Slack + SNS sender
    └── settings/             # App-level settings
src/                   # Frontend (React)
├── pages/             # One file per route
├── components/        # Shared UI components and route guards
├── utils/             # Shared helpers
└── test/              # Vitest suites
```

IAM grants live in the `amplify/` modules listed above, **not** in `backend.ts`. The full annotated tree is in [Architecture → Configuration & Project Layout](docs/pages/architecture-config.md#project-structure).

---

## Getting Started

For the full walkthrough see [Getting Started](docs/pages/getting-started.md) (production) and [Sandbox Deployment](docs/pages/sandbox-deployment.md) (local).

### Prerequisites

- Node.js v18.16.0+
- An AWS account with:
  - IAM Identity Center (IDC) enabled
  - AWS Organizations configured (for account/OU discovery)
  - Permissions to create IDC applications and Amplify apps
- A GitHub account with access to this repository (Amplify Hosting deploys directly from GitHub)

> **Deploy in the same account and Region as IDC.** Snitch calls the IDC Identity Store and SSO APIs directly, so it must run in the account and Region hosting your IAM Identity Center instance. If IDC administration has been **delegated to a member account**, deploy Snitch there — not in the Organizations management account. Delegating IDC to a dedicated account is the recommended practice.

> **Session audit is optional and needs setup.** The audit trail reads from a CloudWatch log group that must live in the Snitch account and Region, which takes a handful of AWS CLI commands to arrange for an organization trail. See [CloudTrail Setup](docs/pages/cloudtrail-setup.md). Without it Snitch works normally; you just don't see what people did during their sessions.

### Install

```bash
npm install
```

### IAM Identity Center setup

Register a **SAML 2.0 application** in IDC and collect:

1. The application's **SAML metadata URL** (public information).
2. Your **Identity Store ID** (`d-xxxxxxxxxxxx`).
3. The immutable **GroupId** (a UUID) of the IDC group whose members should be admins — and optionally an auditor group's GroupId.

> Register a **separate** IDC application for each environment. Don't reuse the production application for a sandbox: each environment has its own Cognito domain, User Pool, ACS URL, and SAML audience, and one application holds only one of each.

These values are supplied as build-time **environment variables**. The canonical reference, including what each optional value defaults to, is [Setup → Environment Variables](docs/pages/setup.md#environment-variables).

Required — the build fails without them:

- `IDC_SAML_METADATA_URL`
- `IDC_IDENTITY_STORE_ID`
- `ADMIN_GROUP_ID` (the IDC GroupId whose members receive the `Admins` claim)

Optional:

- `AUDITOR_GROUP_ID` — the GroupId whose members receive the read-only `Auditors` claim; unset ⇒ no auditors
- `COGNITO_DOMAIN_PREFIX` — auto-derived as `snitch-<branch>-<app-id>` in Amplify Hosting, or `snitch-sandbox-<account-id>` in a sandbox. Set it explicitly only for a custom domain, or to run more than one sandbox in the same AWS account. Must be **globally unique**
- `APP_CALLBACK_URL` — auto-derived as `https://<branch>.<app-id>.amplifyapp.com` in Amplify Hosting, or `http://localhost:5173` in a sandbox

### Deploy to production (Amplify Hosting)

1. In the **AWS Amplify** console, choose **Create new app** and connect this repository and branch.
2. Add the environment variables above. The console hides this field: set it under **Advanced settings** on the create-app **Review** step, or afterward under **Hosting → Environment variables → Manage variables**. (Skip them and the first build fails — add them and redeploy.)
3. **Save and deploy.** Amplify provisions all backend resources and hosts the frontend at `https://<branch>.<app-id>.amplifyapp.com`.
4. After the first deploy, finalize the IDC application's **ACS URL** and **SAML audience** to match the newly created Cognito domain and User Pool ID — see [Getting Started, Step 3a](docs/pages/getting-started.md#3a-finalize-the-acs-url-and-saml-audience-uri).

### Deploy a local sandbox

Register a dedicated sandbox IDC application (per the note above), then set the environment variables in your shell. Copy the tracked template to a git-ignored file holding your real values, edit it, then **source** it — executing it starts a subshell whose exports vanish:

```bash
cp scripts/set-sandbox-env.example.sh scripts/set-sandbox-env.sh
# edit scripts/set-sandbox-env.sh with your real values, then:
source scripts/set-sandbox-env.sh
npx ampx sandbox
```

`npx ampx sandbox` deploys all backend infrastructure and writes `amplify_outputs.json` with the resource endpoints. It hot-reloads: edits under `amplify/` redeploy while it runs.

After the first deploy, update the sandbox application's **SAML audience** to match the new User Pool ID — again, [Getting Started, Step 3a](docs/pages/getting-started.md#3a-finalize-the-acs-url-and-saml-audience-uri).

### Run frontend

```bash
npm run dev
```

App starts at [http://localhost:5173](http://localhost:5173).

### Run tests

```bash
npm run test            # single run
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

---

## Backend Resources

| Resource | Service | Purpose |
|---|---|---|
| Authentication | Amazon Cognito + IAM Identity Center | Sign-in via IDC; group membership drives admin and auditor access |
| API | AWS AppSync | GraphQL API consumed by the frontend |
| Access policy store | AWS Verified Permissions | Evaluates who is allowed to access what |
| Policy metadata | Amazon DynamoDB | Stores policy records, request history, and app settings |
| Access workflow | AWS Step Functions | Assigns and revokes permission sets automatically |
| Live status updates | DynamoDB Streams + AWS Lambda | Republishes request status transitions over AppSync subscriptions so the UI never polls |
| Notifications | Amazon SNS + Slack API | Announces requested / finished / approval events to a topic and channel |
| Slack approvals | Lambda Function URL | Receives signed Slack button callbacks and routes them through the same authorization checks as the web UI |
| Session audit | Amazon CloudWatch Logs | Supplies the AWS activity shown for each access window |
| Resource discovery | AWS Lambda | Fetches live data from IAM Identity Center, AWS Organizations, and SSO |
