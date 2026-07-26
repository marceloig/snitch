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

**Elevated Access** is the admin control room. It shows every access request across every user, lets an admin end an active session early, and links each session to what the user did during it. Admins only.

---

## View All Requests

The page lists every access request from every user, newest first, with its status, requester, account, permission set, duration, and timestamps. Admins can filter and search to find any request.

The table keeps itself current: a new request, an approval decision, a session that expires on its own, and a revocation all appear within about a second, without reloading the page. A **Refresh** button is still there for a manual reload.

---

## Revoke Active Sessions

An admin can select any **active** request and end it before its scheduled expiry — useful when access is no longer needed or a session looks suspicious. Revoking immediately removes the permission set from the user's account, and the admin can record an optional reason, which appears in a **Revoke reason** column for the audit record. The request's status changes to *Revoked*.

Revocation takes a moment behind the scenes — Snitch signals the workflow, which then removes the permission set. The row shows *Revoked* immediately, and the stored record catches up a second or two later. There's no need to refresh and check.

---

## Audit Trail

Opening any request's details shows the AWS activity recorded during that access window — what the user did while their elevated access was live. Snitch narrows it to the actual session times and to that requester's identity, so you're reading one person's session rather than sifting a whole log.

Requires a log group configured in [Settings]({% link pages/settings.md %}#cloudtrail-audit-logs); see [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}) to create one.

{: .note }
The same read-only audit trail is available to auditors on the [Session Activity]({% link pages/session-activity.md %}) page.
