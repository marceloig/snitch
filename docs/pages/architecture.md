---
title: Architecture
layout: default
nav_order: 9
has_children: true
---

# Architecture
{: .no_toc }

How Snitch is built. This section is written for developers and operators working on the system itself — it is the only part of the documentation that assumes familiarity with AWS internals.

---

## System Overview

Snitch is a fullstack AWS application on Amplify Gen 2. It keeps two complementary stores — DynamoDB for application records and AWS Verified Permissions for policy decisions — and hands the grant-and-revoke choreography to Step Functions.

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│            React 19 + Cloudscape Design System          │
└────────────────────────┬────────────────────────────────┘
                         │ GraphQL (Cognito user pool auth)
┌────────────────────────▼────────────────────────────────┐
│                     AWS AppSync                         │
└──┬──────────────┬────────────────────────────────┬──────┘
   │              │                                │
   ▼              ▼                                ▼
DynamoDB      Lambda resolvers              Step Functions
(4 tables)    (CRUD, evaluation,            (JIT grant/revoke
   │           approval, audit)              state machine)
   │              │                                │
   │              ▼                                ▼
   │      AWS Verified Permissions          IAM Identity Center
   │      (Cedar — authoritative for         (SSO Admin API:
   │       every access decision)             assign / remove)
   │
   ▼
DynamoDB Stream (AccessRequestTable)
   │
   ▼
publishRequestStatusChange ──► AppSync subscription ──► Browser

               Slack  ◄──► Lambda Function URL (HMAC-verified)
               Amazon SNS ◄── notification publishers
```

---

## How to Read This Section

| Page | Covers |
|---|---|
| [Stacks & Lambda Placement]({% link pages/architecture-stacks.md %}) | The five CloudFormation stacks, all 31 Lambdas, and where IAM grants live |
| [Data Model & Storage]({% link pages/architecture-data.md %}) | The four DynamoDB tables, the dual-write ordering, and the stream |
| [GraphQL API & Live Updates]({% link pages/architecture-api.md %}) | Every operation with its authorization rule, and how tables update without polling |
| [Access Request Workflow]({% link pages/architecture-workflow.md %}) | All eleven Step Functions states, task tokens, and failure handling |
| [Authorization]({% link pages/architecture-authorization.md %}) | The Cedar schema, both authorization checks, and how group claims are minted |
| [Notifications & Slack Integration]({% link pages/architecture-integrations.md %}) | The notification module, the Slack endpoint, and its signature verification |
| [Configuration & Project Layout]({% link pages/architecture-config.md %}) | Build-time and runtime environment variables, and the repository tree |
