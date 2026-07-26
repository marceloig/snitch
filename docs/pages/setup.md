---
title: Setup
layout: default
nav_order: 2
has_children: true
---

# Setup
{: .no_toc }

Everything you need to get Snitch running, in the order you'll need it.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## The Path

| Guide | Needed? | What it covers |
|---|---|---|
| [Getting Started]({% link pages/getting-started.md %}) | Required | Registering the sign-in application and deploying Snitch to production |
| [Sandbox Deployment]({% link pages/sandbox-deployment.md %}) | Optional | Running the whole stack on your own machine to evaluate it or develop changes |
| [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}) | Optional | Turning on the audit trail, so you can see what people did during a session |
| [Slack Setup]({% link pages/slack-setup.md %}) | Optional | Notifications and one-click approvals in Slack |

Start with Getting Started. The other three can be done later, in any order, without redeploying.

---

## What You Need First

- An AWS account with **IAM Identity Center** turned on and **AWS Organizations** configured.
- Permission to create an Identity Center application and an Amplify app in that account.
- A GitHub account with access to the Snitch repository — production deploys build straight from GitHub.
- The three required configuration values listed below.

Everything else — your users, groups, accounts, Organizational Units, and permission sets — is read live from AWS. There is nothing to import or keep in sync.

New to the vocabulary? [Concepts & Glossary]({% link pages/concepts.md %}) defines every term used across these guides.

---

## Environment Variables

Snitch is configured entirely through environment variables read at build time. These are the same in every environment; only *where you enter them* changes — the Amplify console for a production deploy, your shell for a sandbox.

| Variable | Required | What it's for | Default when unset |
|---|---|---|---|
| `IDC_SAML_METADATA_URL` | Yes | Points Snitch at your Identity Center application, so users can sign in | none — the build fails |
| `IDC_IDENTITY_STORE_ID` | Yes | Lets Snitch look up users and their group memberships (`d-xxxxxxxxxxxx`) | none — the build fails |
| `ADMIN_GROUP_ID` | Yes | The group whose members become Snitch admins | none — the build fails |
| `AUDITOR_GROUP_ID` | No | The group whose members get read-only auditor access | no one gets auditor access |
| `COGNITO_DOMAIN_PREFIX` | No | The prefix of your sign-in web address; must be globally unique | production: `snitch-<branch>-<app-id>`<br>sandbox: `snitch-sandbox-<account-id>` |
| `APP_CALLBACK_URL` | No | Where sign-in returns to, and the link in approval emails | production: `https://<branch>.<app-id>.amplifyapp.com`<br>sandbox: `http://localhost:5173` |

{: .important }
`ADMIN_GROUP_ID` and `AUDITOR_GROUP_ID` are the group's immutable **GroupId** (a UUID), not its name. Snitch keys on the ID, so renaming a group in Identity Center never breaks anyone's access.

The two optional prefix and URL values almost never need to be set by hand. Set `COGNITO_DOMAIN_PREFIX` only if you want a custom sign-in address, or if you're running more than one sandbox in the same AWS account.
