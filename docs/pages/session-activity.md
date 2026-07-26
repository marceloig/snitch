---
title: Session Activity
layout: default
parent: Auditor Features
nav_order: 2
---

# Session Activity
{: .no_toc }

---

## What It Does

**Session Activity** is a read-only record of every session that actually granted access, together with what happened during it. Auditors get the full picture of privileged activity and can change nothing.

For each session the page shows the requester, account, permission set, and the real start and end times of the access. Selecting one opens its details and the **event log** for that window — the AWS activity the user performed while their access was live.

Requires a log group configured in [Settings]({% link pages/settings.md %}#cloudtrail-audit-logs); see [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}) to create one. Without it, sessions still appear but their event log is empty.

The list updates on its own: a session appears as soon as access is actually granted and is marked as ended when it expires or is revoked, with no reload needed. **Refresh** is available for a manual reload.

Timestamps are shown in your browser's local time.

{: .note }
Admins see the same audit trail (plus the ability to revoke sessions) on the [Elevated Access]({% link pages/elevated-access.md %}) page. Session Activity is the read-only, auditor-facing equivalent.
