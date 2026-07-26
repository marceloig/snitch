---
title: "Concepts & Glossary"
layout: default
nav_order: 3
---

# Concepts & Glossary
{: .no_toc }

The vocabulary used throughout this documentation, defined once.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## How Snitch Thinks About Access

Nobody in Snitch holds permanent access to an AWS account. Instead, an admin writes a **privileged policy** that says what a person is *allowed to ask for* — which accounts, with which permissions, and for how long at most. When that person actually needs the access, they request it, say why, and pick an end time.

If the policy calls for it, an approver signs off first. Snitch then grants the access, holds it open for exactly as long as was requested, and takes it away again on its own. Every step is recorded: who asked, who approved, when the session opened and closed, and what the person did while it was open.

The short version: permission to *ask* is permanent, access itself never is.

---

## Identity and Organization Terms

**IAM Identity Center** — AWS's workforce sign-in service, where your users and groups live. Snitch doesn't manage passwords; it hands sign-in off to Identity Center and reads group membership from it. You'll also see it written as IdC or, in older AWS material, AWS SSO.

**Permission set** — a named bundle of AWS permissions defined in Identity Center, such as `ReadOnlyAccess` or `AdministratorAccess`. Granting someone access means attaching a permission set to them on a specific account. Snitch never creates permission sets; it uses the ones you already have.

**Principal** — whoever a rule applies to: an individual user, or a group.

**Organizational Unit (OU)** — a folder of AWS accounts inside your organization. Pointing a policy at an OU covers every account in it, so you don't have to list accounts one by one.

**Organization trail** — a single audit log that captures activity across every account in your organization, rather than one account at a time. It's owned by your organization's management account.

**Delegated administrator** — a member account that's been given permission to administer an AWS service on the organization's behalf, so the management account doesn't have to. Snitch expects to run in the account that's the delegated administrator for Identity Center.

---

## Access Terms

**Standing access** — permissions someone holds permanently, whether or not they're using them. This is what Snitch exists to eliminate: standing access is the thing an attacker finds waiting for them.

**Just-in-time (JIT) access** — the opposite. Permissions are granted at the moment of need and withdrawn automatically afterward, so the window in which they can be misused is measured in hours instead of years.

**Elevated access session** — one granted period of access: it opens when the permission set is attached and closes when it's removed. Sessions are what auditors review.

**Time-limited** — every session carries a fixed end time chosen at request time. It can end early, but it can't run past that point.

---

## Policy Terms

Snitch has two kinds of policy, and they answer different questions.

| | Privileged policy | Approval policy |
|---|---|---|
| Answers | *Who may request what?* | *Who may approve it?* |
| Points at | A user or group, plus accounts and OUs | An approver, plus one account |
| Also sets | The permission set and the maximum duration | Which permission sets the approver can sign off on |
| Managed on | The **Privileged Policies** page | The **Approval Policies** page |

The two are independent. A privileged policy with **Requires approval** switched off grants access with no human in the loop. One with it switched on waits for someone an approval policy has named. See [Privileged Policies]({% link pages/privileged-policies.md %}) and the [Approval Workflow]({% link pages/approval-workflow.md %}).

**Cedar** — the open-source policy language Snitch writes its rules in. You never write Cedar by hand; the app generates it from the choices you make in the forms.

**Policy store** — the managed AWS service that holds those rules and answers the yes-or-no question "is this person allowed to do this?" Keeping that decision in one place means access can't be granted by a bug in application code. See [Architecture → Authorization]({% link pages/architecture-authorization.md %}) if you want the mechanics.

---

## Roles in Snitch

| Role | Who they are | What they can do |
|---|---|---|
| **Requester** | Any signed-in user | Request access to whatever their privileged policies allow, and see their own history |
| **Approver** | Anyone named by an approval policy — **not** necessarily an admin | Approve or reject the requests they're authorized for. Never their own |
| **Admin** | Member of the admin group | Everything: write policies, see all requests, end sessions early, change settings |
| **Auditor** | Member of the auditor group | Read-only. Review approval decisions and session activity, change nothing |

Admin and auditor are independent — someone can hold either, both, or neither. To grant them, add the person to the matching Identity Center group; see [Getting Started]({% link pages/getting-started.md %}#3b-grant-admin-access).
