---
title: Slack Setup
layout: default
parent: Setup
nav_order: 4
---

# Slack Setup
{: .no_toc }

Connecting Snitch to Slack takes about ten minutes and gives approvers a way to act without opening the app.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## What This Enables

Once Slack is connected, Snitch can post to a channel of your choosing when someone requests access and when a session ends. More usefully, when a request needs approval, the message carries **Approve** and **Reject** buttons — an approver taps one and the request moves, no sign-in required.

Slack is entirely optional. Skip this page and Snitch works exactly as it does today; approvers just use the [Approve Requests]({% link pages/approval-workflow.md %}) page instead.

{: .important }
Steps 1–5 set up notifications. **Step 6 and Step 7 are what make the buttons work.** Skip them and the messages still arrive, but tapping Approve does nothing at all — Slack has nowhere to send the click.

---

## Step 1 — Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App → From scratch**.
2. Name it (`Snitch` works) and pick the workspace it should live in.

---

## Step 2 — Add the Bot Token Scopes

Open **OAuth & Permissions** and add all three of these under **Bot Token Scopes**:

| Scope | Why it's needed |
|---|---|
| `chat:write` | Post messages into the channel |
| `users:read` | Look up the person who tapped a button |
| `users:read.email` | Read that person's email address, which is how Snitch matches them to their Snitch identity |

{: .warning }
All three are required. `users:read` is easy to miss because `users:read.email` sounds like it covers both — it doesn't, and without it every button tap fails with a lookup error.

---

## Step 3 — Install the App and Copy the Bot Token

Still under **OAuth & Permissions**, choose **Install to Workspace** and approve the prompt. Copy the **Bot User OAuth Token** that appears — it starts with `xoxb-`. You'll paste it into Snitch in Step 8.

---

## Step 4 — Copy the Signing Secret

Open **Basic Information → App Credentials** and copy the **Signing Secret**.

This is what proves to Snitch that an incoming button tap genuinely came from Slack. Treat it like a password.

---

## Step 5 — Invite the Bot and Copy the Channel ID

1. In Slack, open the channel you want the messages in and run `/invite @Snitch` (or whatever you named the app). The bot can't post to a channel it isn't in.
2. Open the channel's details and copy the **Channel ID** from the bottom — it looks like `C01234ABCDE`.

---

## Step 6 — Find the Snitch Slack Endpoint

Slack needs a web address to send button taps to. Snitch creates one automatically when you deploy, but does not display it anywhere.

{: .warning }
Don't go looking for this address in your deployment outputs. **It isn't published there**, and it isn't in `amplify_outputs.json` either. Use one of the two methods below.

**From the AWS console:** open **Lambda → Functions**, filter for `slackInteractive`, open the matching function (its full name is prefixed with your app and branch), and go to **Configuration → Function URL**. Copy the URL.

**From the command line:**

```bash
aws lambda list-functions \
  --query "Functions[?contains(FunctionName,'slackInteractive')].FunctionName" \
  --output text

aws lambda get-function-url-config \
  --function-name <name-from-above> \
  --query FunctionUrl --output text
```

Run these in the account and Region you deployed Snitch into. The result looks like `https://<id>.lambda-url.<region>.on.aws/`.

{: .note }
Each environment gets its own endpoint. If you run both a sandbox and a production deployment, they need separate Slack apps — pointing one app at both is what causes the `Invalid signature` error in the troubleshooting table below.

---

## Step 7 — Turn On Interactivity

1. In your Slack app, open **Interactivity & Shortcuts** and switch **Interactivity** on.
2. Paste the URL from Step 6 into **Request URL**.
3. **Save Changes.**

Slack sends a test request when you save. If it reports a failure, the URL is wrong or the app hasn't been deployed yet.

---

## Step 8 — Enter the Credentials in Snitch

Sign in to Snitch as an admin, open **Settings → Slack Integration**, and fill in:

| Field | Value |
|---|---|
| **Bot Token** | The `xoxb-` token from Step 3 |
| **Channel ID** | The `C…` ID from Step 5 |
| **Signing Secret** | The secret from Step 4 |

Save, then turn on the notification toggles you want in the **Access-Request Notifications** card below it. [Settings]({% link pages/settings.md %}#notifications) covers which events go to which channel.

---

## Verifying

1. Submit an access request against a policy that has **Requires approval** turned on.
2. A message should appear in your channel within a few seconds, showing the requester, account, permission set, duration, and justification, with **Approve** and **Reject** buttons beneath it.
3. Tap **Approve**. The message should be replaced with `✅ Approved by <your email>`, and the request should move out of *Pending approval* in the app.

If the message arrives but tapping does nothing, Step 7 is incomplete.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No messages at all | Toggles off, bot not in the channel, or the wrong Channel ID | Check the toggles in Settings, run `/invite` in the channel, re-copy the Channel ID |
| Buttons appear but nothing happens when tapped | Interactivity isn't turned on, or the Request URL is missing | Redo Step 7 |
| Slack shows `Invalid signature` | The signing secret in Settings doesn't match the app, or the Request URL points at a different environment | Re-copy the secret from Step 4; confirm the URL came from the same deployment |
| "Could not retrieve your Slack email address" | The `users:read` or `users:read.email` scope is missing, or the profile has no visible email | Add both scopes in Step 2, then reinstall the app |
| "You are not authorized to approve this request" | No approval policy covers that account and permission set for you | See [Approval Workflow]({% link pages/approval-workflow.md %}#configuring-who-can-approve) |
| "This request is no longer pending approval" | Someone already decided it, or it timed out after 24 hours | Expected — no action needed |
| Approving your own request is refused | Requesters can't approve their own requests | Expected. Ask someone else to sign off |

---

## Security Notes

The Slack endpoint is deliberately open at the network layer — Slack can't authenticate to AWS, so there's no way to put an AWS credential in front of it. What protects it is the signature Slack attaches to every request, which Snitch verifies with your signing secret before it will act on anything. That's why the signing secret matters as much as the bot token.

Two further checks run behind that one: the request must still be pending, and the person who tapped must be authorized to approve that specific account and permission set. Being in the Slack channel grants nothing on its own.

[Architecture → Notifications & Slack Integration]({% link pages/architecture-integrations.md %}) documents how the verification works, and notes one known gap in it.
