---
title: Settings
layout: default
parent: Admin Features
nav_order: 2
---

# Settings
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## What It Does

The **Settings** page (admin-only) is where administrators configure application-level options, grouped into three cards:

- **CloudTrail Audit Logs** — the CloudWatch log group that powers the audit trail.
- **Slack Integration** — the Slack app credentials used for approval messages and notifications.
- **Access-Request Notifications** — the per-channel toggles for Slack and email alerts.

---

## CloudTrail Audit Logs

To turn on the audit trail for the [Elevated Access]({% link pages/elevated-access.md %}) and [Session Activity]({% link pages/session-activity.md %}) pages:

1. Set up the log group first — follow [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}).
2. Open **Settings** in Snitch.
3. Enter the log group name in **CloudWatch Log Group** (for example `CloudTrail/snitch-audit`) and save.

Enter the log group's **name**, not its ARN. Once it's set, Snitch queries that log group for each session's activity. Leave it blank and the audit trail is simply empty — nothing else breaks.

---

## Notifications

Snitch can notify a team channel or mailing list about the access-request lifecycle through two independent channels — **Slack** and **email (Amazon SNS)**. Every notification is best-effort: if delivery fails, it never blocks or breaks the underlying access request.

### What gets notified

| Event | When it fires | Channels |
|---|---|---|
| **Access requested** | A user submits a request | Slack, email |
| **Access finished** | A granted session ends (expired or revoked) | Slack, email |
| **Approval required** | A request is waiting for an approver | Slack (interactive buttons), email (link to the app) |

Each channel is controlled by its own toggle, so you can, for example, send approval alerts by email while sending requested/finished updates to Slack.

### Slack

Fill in **Bot Token**, **Channel ID**, and **Signing Secret** in the **Slack Integration** card, then turn on the Slack toggle. Creating the Slack app and finding those three values is covered step by step in [Slack Setup]({% link pages/slack-setup.md %}).

- **Requested / finished** messages are informational.
- **Approval required** messages carry **Approve** and **Reject** buttons, so approvers can decide without leaving Slack. Snitch verifies who tapped the button and checks their authorization before acting, so only real approvers can move a request.

### Email (Amazon SNS)

Email notifications are delivered through an app-managed Amazon SNS topic. To receive them:

1. Deploy the backend so the topic exists.
2. In **Settings**, copy the read-only **SNS Topic ARN**.
3. In the AWS console, create a subscription on that topic (protocol **Email** or **SMS**) for your endpoint, and confirm it from the confirmation message.
4. Enable the relevant SNS toggle(s) in Settings.

Email subject lines include the account label, for example `AWS access approval required - Production (111111111111)`.

{: .note }
Approval **emails** deliberately carry no one-click buttons. There's no way to tell who actually clicked a link in an email, so the message links to the in-app Approve Requests page instead, where the approver signs in first. Slack messages can stay interactive because Slack signs every button tap, which lets Snitch confirm who sent it.
