---
title: Access Requests
layout: default
nav_order: 5
---

# Access Requests
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## What It Does

Any signed-in user can request **temporary, time-limited access** to an AWS account from the self-service **Request Access** page. Snitch grants the permission set automatically, holds it open for the requested period, then takes it away — no manual cleanup, no leftover access.

---

## Requesting Access

The form offers only what you're allowed to ask for. Based on your [Privileged Policies]({% link pages/privileged-policies.md %}), Snitch shows:

- The **accounts** you can reach.
- The **permission sets** available on each one.
- The **longest duration** you can request.

Pick an account, a permission set, and when the access should end. Add a justification if you like, and submit.

If the matching policy requires approval, the form says so before you submit, and the request waits for an approver before anything is granted.

---

## What Happens After Submitting

Once submitted, the request runs through an automated workflow:

1. If approval is required, it waits for an approver to act (or times out after 24 hours).
2. If a future start time was chosen, it waits until then.
3. The permission set is assigned to the user on the target account — access is now **active**.
4. When the duration elapses, the permission set is removed automatically.

An admin can also end an active session early from the [Elevated Access]({% link pages/elevated-access.md %}) page.

---

## Request Statuses

Every request shows its current status:

| Status | Meaning |
|---|---|
| **Pending** | No approval needed; waiting for the permission set to be assigned |
| **Pending approval** | Waiting for an approver to act |
| **Scheduled** | Approved, waiting for a future start time |
| **Active** | Access is granted right now |
| **Expired** | The duration elapsed (or an approval timed out) and access was removed |
| **Revoked** | An admin ended the session early |
| **Rejected** | An approver rejected the request |
| **Failed** | Something went wrong in the workflow |

---

## Request History

Each user sees their own request history on the Request Access page, with the status, account, permission set, and duration of every request they've made.
