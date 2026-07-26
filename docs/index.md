---
title: Home
layout: home
nav_order: 1
---

# Snitch — Privileged Access Management
{: .fs-9 }

Give people the AWS access they need, exactly when they need it, and take it back automatically.
{: .fs-6 .fw-300 }

[Get Started]({% link pages/setup.md %}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/camarim-cloud/snitch){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Snitch?

Most AWS access is permanent: someone gets a role for a project, and still has it two years later. Snitch replaces that with access you ask for and receive for a set period.

An admin writes the rules — who may request what, on which accounts, for how long at most. From there it's self-service. A user picks an account, says why they need it, and chooses when the access should end. If the rule calls for a sign-off, an approver gets a notification and decides. Snitch grants the access, holds it open, and removes it on schedule with nothing left behind.

Everything is recorded along the way, so auditors can answer "who had access, who approved it, and what did they do with it" without asking anyone.

## Core Features

| Feature | Description |
|---|---|
| **Access rules** | Admins define who may request access to which accounts, with which permissions, and for how long |
| **Self-service requests** | Users request time-limited access and get it automatically — no ticket, no waiting on an admin |
| **Approval gate** | Any rule can require sign-off first, with approvers configured per account |
| **Automatic revocation** | Access ends on schedule. Admins can also cut a session short at any time |
| **Notifications** | Slack and email alerts when access is requested, when it ends, and when someone needs to approve — each toggled independently |
| **Central authorization** | Every access decision is made by one policy engine, not by scattered application logic |
| **Audit trail** | Each session links to the AWS activity that happened during it |
| **Live updates** | Admin and auditor tables refresh themselves as requests change status — no polling, no page reload |

## Technology Stack

- **Frontend**: React 19 + TypeScript, Vite, Cloudscape Design System, React Router v7
- **Backend**: AWS Amplify Gen 2 (AppSync GraphQL + DynamoDB + Cognito)
- **Authorization**: AWS Verified Permissions (Cedar policies)
- **Workflow**: AWS Step Functions + IAM Identity Center
- **Testing**: Vitest + React Testing Library

New here? [Setup]({% link pages/setup.md %}) walks through deployment, and [Concepts & Glossary]({% link pages/concepts.md %}) defines the vocabulary.
