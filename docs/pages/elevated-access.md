---
title: Elevated Access
layout: default
parent: Admin Features
nav_order: 1
---

# Elevated Access
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## What It Does

**Elevated Access** is the admin control room for JIT access. It gives administrators complete visibility into every access request across all users, the ability to end active sessions early, and a per-session CloudTrail audit trail. It is available only to admins.

---

## View All Requests

The page lists every access request from every user, newest first, with its status, requester, account, permission set, duration, and timestamps. Admins can filter and search to find any request.

The table keeps itself current: a new request, an approval decision, a session that expires on its own, and a revocation all appear within about a second, without reloading the page. A **Refresh** button is still there for a manual reload.

---

## Revoke Active Sessions

An admin can select any **active** request and end it before its scheduled expiry — useful when access is no longer needed or a session looks suspicious. Revoking immediately removes the permission set from the user's account, and the admin can record an optional reason, which appears in a **Revoke reason** column for the audit record. The request's status changes to *Revoked*.

Revocation is not instantaneous behind the scenes — Snitch signals the workflow, which then removes the permission set. The row shows *Revoked* right away and settles onto the stored record once the removal completes, so there is no need to refresh and check.

---

## CloudTrail Audit Trail

For any request, an admin can open its details to see the **CloudTrail events** generated during that access window — exactly what the user did while their elevated access was active. Snitch narrows the audit trail to the real session window and to the requester's identity, so each session's activity is easy to review.

This requires a CloudTrail log group to be configured on the [Settings]({% link pages/settings.md %}#cloudtrail-audit-logs) page. Without it, the audit trail is empty. See [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}) for how to create that log group and point your trail at it.

{: .note }
The same read-only audit trail is available to auditors on the [Session Activity]({% link pages/session-activity.md %}) page.
