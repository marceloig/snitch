---
title: Getting Started
layout: default
parent: Setup
nav_order: 1
---

# Getting Started
{: .no_toc }

Deploying Snitch to production takes three steps: register a sign-in application, deploy, then connect the two together. Budget about an hour, most of it waiting on the first build.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

- An AWS account with **IAM Identity Center** enabled and **AWS Organizations** configured, so Snitch can discover your accounts and Organizational Units.
- Permission to create Identity Center applications and Amplify apps in that account.
- A GitHub account with access to the Snitch repository — Amplify Hosting builds directly from GitHub.

{: .important }
Snitch must be deployed in the **same AWS account and Region** as IAM Identity Center. It calls the Identity Store and SSO APIs directly, and those are only reachable from the account that hosts your Identity Center instance. If administration has been delegated to a member account, deploy Snitch **there**, not in the management account.

{: .note }
Delegating Identity Center administration to a dedicated member account is the recommended setup. Keeping both Identity Center and Snitch out of the management account limits the damage if either is ever compromised, and follows AWS's guidance on separating workloads from the management account. See [Delegated administration for IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/delegated-admin.html).

Sign-in goes through Identity Center over SAML 2.0. Amazon Cognito sits behind it and issues the tokens the app uses, so you never manage passwords in Snitch.

Planning to use the audit trail? It needs a CloudWatch log group in the Snitch account, which takes a few AWS CLI commands to set up. You can do that any time after deploying — see [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}).

---

## Step 1 — Register the IAM Identity Center Application

Snitch needs a SAML 2.0 application in Identity Center so your people can sign in. This step covers your **production** deployment; a sandbox needs its own separate application, covered in [Sandbox Deployment]({% link pages/sandbox-deployment.md %}).

### 1a. Choose a sign-in domain prefix

Your sign-in page lives at a prefixed AWS-hosted address, and that prefix must be **globally unique across all AWS accounts** in the Region — pick something specific to your organization, because a taken prefix fails the deploy. The prefix forms both the sign-in URL and the SAML **Assertion Consumer Service (ACS) URL** you'll register:

```
https://snitch-example.auth.us-east-1.amazoncognito.com/saml2/idpresponse
```

Substitute your prefix and Region.

{: .note }
On Amplify Hosting the prefix is generated for you as `snitch-<branch>-<app-id>`. You won't know your app id until the app exists, so register a placeholder now and correct it in Step 3.

### 1b. Register the SAML 2.0 application

1. Open **IAM Identity Center → Applications → Add application → I have an application I want to set up**.
2. Choose **SAML 2.0** and name it (`Snitch` works).
3. Under **Application metadata**, set:

   | Field | Value |
   |---|---|
   | **Application ACS URL** | `https://snitch-example.auth.us-east-1.amazoncognito.com/saml2/idpresponse` — you'll finalize this in Step 3 once the real domain exists |
   | **Application SAML audience** | `urn:amazon:cognito:sp:placeholder` — also finalized in Step 3 |

4. Under **Attribute mappings**, add the email mapping:

   | User attribute in the application | Maps to |
   |---|---|
   | `email` | `${user:email}` |

   {: .important }
   This mapping is required. Snitch uses the email to look each user up in Identity Center and resolve their group memberships — without it, nobody can sign in successfully.

5. **Save**, then copy the **SAML metadata URL** from the application page. It looks like `https://<idc-instance>.awsapps.com/start/saml/metadata/<app-id>`.
6. **Assign** the users or groups who should be able to sign in.

### 1c. Collect the identifiers you'll need

| Value | Where to find it |
|---|---|
| **SAML metadata URL** | Copied in step 1b |
| **Identity Store ID** (`d-xxxxxxxxxxxx`) | Identity Center console → **Settings → Identity source** |
| **Admin group ID** | The **GroupId** (a UUID) of the group whose members should be Snitch admins |
| **Auditor group ID** (optional) | The GroupId of the group whose members get read-only auditor access |

Both group values are the immutable GroupId, not the group's name — see [Environment Variables]({% link pages/setup.md %}#environment-variables).

---

## Step 2 — Deploy with AWS Amplify Hosting

1. Open the **AWS Amplify** console → **Create new app**.
2. Choose **GitHub**, authorize Amplify, and select the Snitch repository and the branch to deploy.
3. Add the environment variables you collected in Step 1. The console doesn't prompt for these on the main screen — the editor is tucked away in one of two places:

   - **During creation:** on the final **Review** step, expand **Advanced settings**. The **Environment variables** editor is inside.
   - **Afterward, or to change them:** **Hosting → Environment variables** (only visible once the app is connected to the repo) → **Manage variables → add variable → Save**. Amplify applies variables to all branches by default, so there's no need to re-enter them per branch.

   Add the four variables marked required in [Environment Variables]({% link pages/setup.md %}#environment-variables). On Amplify Hosting the sign-in prefix and callback URL are derived from your app id and branch, so you can leave both unset.

   {: .important }
   Skipping the variables during creation makes the first build fail. That's expected — add them under **Hosting → Environment variables** and redeploy the branch.

4. **Save and deploy.** Amplify provisions the entire backend and hosts the frontend.

When the build finishes you'll have an app URL in the form `https://<branch>.<app-id>.amplifyapp.com`.

---

## Step 3 — Finalize the Setup

Three one-time steps after the first successful deploy, plus one optional.

### 3a. Finalize the ACS URL and SAML audience URI

The sign-in domain and user pool ID only exist once the app has deployed, so the placeholders from Step 1 need correcting now.

1. Open the Identity Center application from Step 1.
2. Set **Application metadata → Application ACS URL** to your real domain:

   ```
   https://snitch-example.auth.us-east-1.amazoncognito.com/saml2/idpresponse
   ```

   On Amplify Hosting the prefix is `snitch-<branch>-<app-id>`.
3. Set **Application metadata → Application SAML audience** to:

   ```
   urn:amazon:cognito:sp:<USER_POOL_ID>
   ```

   Find the user pool ID in the Amplify or Cognito console — it looks like `<REGION>_XXXXXXXXX`.
4. Save.

{: .important }
Sign-in fails with a SAML mismatch until both values match. Repeat this step after any deployment that creates a fresh user pool — a new environment, or a rebuild from scratch.

### 3b. Grant admin access

Admin pages are gated by membership in the group whose GroupId you set as `ADMIN_GROUP_ID`. Add people to that Identity Center group to make them Snitch admins — nothing to change in Cognito. They'll need to sign out and back in to pick up the change.

### 3c. Grant auditor access (optional)

The read-only auditor pages — **Approval History** and **Session Activity** — work the same way, through `AUDITOR_GROUP_ID`. The two are independent: someone can be an admin, an auditor, both, or neither.

### 3d. Configure the audit trail (optional)

To see what people did during their sessions, an admin enters a CloudWatch log group name on the **Settings** page. Creating that log group is a one-time AWS-side task — follow [CloudTrail Setup]({% link pages/cloudtrail-setup.md %}) first.

Nothing else needs configuring. Users, groups, accounts, Organizational Units, and permission sets are all read live from AWS.

---

## Next Steps

- Write your first rule on the [Privileged Policies]({% link pages/privileged-policies.md %}) page.
- Turn on [Slack notifications and one-click approvals]({% link pages/slack-setup.md %}).
- Run a [local sandbox]({% link pages/sandbox-deployment.md %}) for development.
