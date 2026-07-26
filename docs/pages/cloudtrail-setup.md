---
title: CloudTrail Setup
layout: default
nav_order: 4
---

# CloudTrail Setup
{: .no_toc }

Snitch's audit trails — [Elevated Access]({% link pages/elevated-access.md %}) for admins and [Session Activity]({% link pages/session-activity.md %}) for auditors — read CloudTrail events from a **CloudWatch Logs log group**. This page walks through configuring that log group with the AWS CLI so Snitch can actually read it.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Why This Is Required

Snitch queries CloudWatch Logs from inside its own AWS account and Region. There is no cross-account or cross-Region access anywhere in the audit path, which means the **log group must exist in the same AWS account and Region where Snitch is deployed** — the IAM Identity Center delegated administrator account (see [Getting Started → Prerequisites]({% link pages/getting-started.md %}#prerequisites)).

In an AWS Organization the trail you want to read is normally an **organization trail**, and that trail is owned by the management account. AWS constrains how its CloudWatch Logs destination can be set:

- Only the **management account** can attach a CloudWatch Logs log group to an organization trail **using the console** — and doing so creates the log group in the management account, where Snitch cannot reach it.
- A **CloudTrail delegated administrator** can attach a log group too, but **only through the AWS CLI or the `CreateTrail` / `UpdateTrail` API operations**. In that case "both the CloudWatch Logs log group and log role must exist in the calling account."

{: .important }
So the account running Snitch must be registered as a **CloudTrail delegated administrator**, and the trail's CloudWatch Logs destination must be configured **by CLI from that account**. Configuring it from the management account console puts the log group in the wrong account and the audit trail stays permanently empty.

---

## Prerequisites

- **AWS Organizations** with all features enabled.
- An existing **CloudTrail organization trail** (or the account-level trail whose events you want Snitch to read).
- The **AWS account ID of the Snitch deployment** — the same account and Region you deployed Snitch into.
- AWS CLI access to **both** accounts: the **management account** for Step 1, and the **Snitch account** for Steps 2–5.
- Permission to create IAM roles in the Snitch account.

Placeholders used throughout this page:

| Placeholder | Meaning |
|---|---|
| `<snitch_account_id>` | The 12-digit account ID where Snitch is deployed (the delegated administrator) |
| `<management_account_id>` | The Organizations management account ID — it appears in the **trail ARN** |
| `<region>` | The Region Snitch is deployed in |
| `<log_group_name>` | The CloudWatch Logs log group, e.g. `CloudTrail/snitch-audit` |
| `<trail_name>` | The name of the CloudTrail trail |
| `<organization_id>` | The AWS Organizations ID, e.g. `o-aa111bb222` |

---

## Step 1 — Register the Snitch Account as a CloudTrail Delegated Administrator

Run this **from the management account**:

```bash
aws cloudtrail register-organization-delegated-admin \
  --member-account-id "<snitch_account_id>"
```

The command produces no output when it succeeds.

{: .note }
An organization can have at most three CloudTrail delegated administrators. The management account remains the **owner** of every organization trail regardless — registering a delegated administrator grants administrative permissions, it does not move ownership.

---

## Step 2 — Create the Log Group

Run the remaining steps **from the Snitch account**, in the **Snitch Region**:

```bash
aws logs create-log-group --log-group-name CloudTrail/snitch-audit
```

Confirm it exists and note its ARN:

```bash
aws logs describe-log-groups --log-group-name-prefix CloudTrail/snitch-audit
```

{: .important }
The log group's Region must match the Region Snitch runs in. A log group created in a different Region is invisible to Snitch even when the account is correct.

---

## Step 3 — Create the IAM Role CloudTrail Assumes

CloudTrail needs a role in the Snitch account that it can assume to write into the log group. Save the following as `assume_role_policy_document.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudtrail.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Create the role:

```bash
aws iam create-role \
  --role-name CloudTrail_CloudWatchLogs_Snitch \
  --assume-role-policy-document file://assume_role_policy_document.json
```

Take note of the **role ARN** in the output — Step 5 needs it.

---

## Step 4 — Attach the Role Policy

This policy lets CloudTrail create log streams in the log group and deliver events to them. Because the trail is an **organization trail**, two log-stream patterns are required: the delegated administrator account's own stream, and the `<organization_id>_*` streams that carry events from every member account.

Save the following as `role-policy-document.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AWSCloudTrailCreateLogStream20141101",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream"
      ],
      "Resource": [
        "arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:log-stream:<snitch_account_id>_CloudTrail_<region>*",
        "arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:log-stream:<organization_id>_*"
      ]
    },
    {
      "Sid": "AWSCloudTrailPutLogEvents20141101",
      "Effect": "Allow",
      "Action": [
        "logs:PutLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:log-stream:<snitch_account_id>_CloudTrail_<region>*",
        "arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:log-stream:<organization_id>_*"
      ]
    }
  ]
}
```

Apply it to the role:

```bash
aws iam put-role-policy \
  --role-name CloudTrail_CloudWatchLogs_Snitch \
  --policy-name cloudtrail-policy \
  --policy-document file://role-policy-document.json
```

{: .note }
A single broader resource — `arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:log-stream:*` — also works and is simpler to write, at the cost of a wider grant. The two explicit patterns above are the least-privilege form.

{: .warning }
Omitting the `<organization_id>_*` pattern is the most common mistake here. The log group is created successfully but stays empty, because CloudTrail cannot create the per-organization log streams that carry member-account events.

---

## Step 5 — Point the Trail at the Log Group

This is the step the console cannot perform from the delegated administrator account.

First retrieve the trail's **full ARN**:

```bash
aws cloudtrail list-trails
```

Then update the trail, passing that ARN to `--name`:

```bash
aws cloudtrail update-trail \
  --name "arn:aws:cloudtrail:<region>:<management_account_id>:trail/<trail_name>" \
  --cloud-watch-logs-log-group-arn "arn:aws:logs:<region>:<snitch_account_id>:log-group:<log_group_name>:*" \
  --cloud-watch-logs-role-arn "arn:aws:iam::<snitch_account_id>:role/CloudTrail_CloudWatchLogs_Snitch"
```

{: .important }
**`--name` must be the full trail ARN, not the trail name.** An organization trail is owned by the management account, so its ARN carries the **management account ID**. When the delegated administrator passes a bare name, CloudTrail resolves it against the *calling* account and fails with a trail-not-found error. The ARN is the only form that works from the delegated administrator account.

Note that the account IDs in that command are deliberately different: the **trail** ARN carries `<management_account_id>` because the management account owns it, while the **log group** and **role** ARNs carry `<snitch_account_id>` because both must exist in the calling account.

---

## Step 6 — Enter the Log Group in Snitch

1. Sign in to Snitch as an admin and open **Settings** → [CloudTrail Audit Logs]({% link pages/settings.md %}#cloudtrail-audit-logs).
2. Enter the log group **name** — not its ARN — for example `CloudTrail/snitch-audit`.
3. Save.

---

## Verifying

1. In the CloudWatch console of the Snitch account, open **Logs → Log groups → `<log_group_name>`**. Log streams named `<account_id>_CloudTrail_<region>...` should appear.
2. Give it a few minutes. CloudTrail delivers events to CloudWatch Logs within an average of about 5 minutes of an API call; the delay is not guaranteed.
3. In Snitch, open a session that has already been activated on **Session Activity** or **Elevated Access** and confirm its CloudTrail event log is populated.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Audit trail is always empty | The log group lives in the management account, not the Snitch account | Redo Steps 2–5 from the Snitch account |
| Audit trail empty in one Region only | The log group's Region differs from Snitch's deployment Region | Create the log group in the Snitch Region and rerun Step 5 |
| `update-trail` reports the trail was not found | `--name` was given the trail **name** | Pass the full trail ARN, which carries the management account ID |
| `update-trail` is denied | The command wasn't run from the delegated administrator account, or Step 1 was skipped | Register the account (Step 1) and rerun from that account |
| Log group exists but has no log streams | The role policy is missing the `<organization_id>_*` log-stream resource | Re-apply the policy from Step 4 |
| A few events never show up | CloudTrail does not deliver events larger than 256 KB to CloudWatch Logs | Expected AWS behavior; no fix |
| Events exist in the log group but not for a given user | Snitch filters the log group by the requester's email as it appears in `userIdentity.arn` | Only IAM Identity Center `AssumedRole` sessions carry the email in the ARN and will match |

---

## Reference

- [Sending CloudTrail events to CloudWatch Logs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/send-cloudtrail-events-to-cloudwatch-logs.html)
- [CloudTrail organization delegated administrator](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-delegated-administrator.html)
- [Creating a trail for an organization](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/creating-trail-organization.html)
