---
title: "Notifications & Slack Integration"
layout: default
parent: Architecture
nav_order: 6
---

# Notifications & Slack Integration
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Notification Module

`amplify/functions/notifications/notify.ts` is a shared, best-effort sender. It exports three things:

| Export | Sends | Called by |
|---|---|---|
| `notifyAccessEvent({ kind: "REQUESTED" })` | Slack and/or SNS | `requestAccessHandler`, after the record is persisted |
| `notifyAccessEvent({ kind: "FINISHED" })` | Slack and/or SNS | `removePermissionSetHandler`, after the status reaches `EXPIRED` or `REVOKED` |
| `notifyPendingApproval(…)` | SNS only | `storeApprovalTokenHandler`, when a request enters `PENDING_APPROVAL` |
| `formatDurationMinutes(minutes)` | — | Shared formatter, also imported by `storeApprovalTokenHandler` |

Each channel reads its own toggle from the `settingKey: "global"` record: `slackNotificationsEnabled` and `snsNotificationsEnabled` for the requested/finished pair, `snsApprovalNotificationsEnabled` for approval emails. The three are independent, so a team can route approvals to email while sending lifecycle updates to Slack.

{: .important }
Every path is wrapped in try/catch and **never throws**. A Slack outage or an unconfirmed SNS subscription must not fail an access request, and it must not fail a Step Functions state either — `storeApprovalTokenHandler` would otherwise lose the task token and strand the execution.

SNS publishes to one app-managed topic, `AccessNotificationsTopic`, created in `accessRequestWorkflow.ts`. Admins subscribe endpoints to it by hand; Snitch never manages subscriptions. Email subjects are built dynamically and truncated to SNS's 100-character limit, in the form `AWS access approval required - <account (id)>`.

`notifyPendingApproval` links to `${appUrl}#/approve-requests` rather than offering one-click actions. An email recipient can't be authenticated, so the link puts them in front of the normal signed-in approval flow. The Slack message can be interactive precisely because Slack signs its callbacks.

---

## Slack Endpoint

`storeApprovalTokenHandler` has its own `sendSlackNotification` (separate from `notify.ts`) that posts the interactive approval message: a header block, a section with requester, account, permission set, duration, and justification, and an actions block with two buttons carrying `action_id` `approve` and `reject` and the request id as their `value`.

{: .note }
That approval message is gated only on `slackBotToken` and `slackChannelId` both being set — **not** on `slackNotificationsEnabled`. That toggle governs only the informational requested/finished messages in `notify.ts`.

Button taps come back to a Lambda Function URL created in `amplify/slackHandler.ts`:

```typescript
slackLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: { allowedOrigins: ["https://slack.com"] },
});
```

`authType: NONE` is unavoidable. Slack cannot sign a request with SigV4, so IAM authorization would reject every callback. The HMAC signature described below is the authentication, and the CORS restriction is defense in depth, not a control — it constrains browsers, not servers.

{: .warning }
The URL is **not** published as a stack output and does not appear in `amplify_outputs.json`. Admins must retrieve it from the Lambda console or CLI; [Slack Setup]({% link pages/slack-setup.md %}#step-6--find-the-snitch-slack-endpoint) documents both routes.

---

## Signature Verification

`slackInteractiveHandler.ts` reads `x-slack-request-timestamp` and `x-slack-signature`, then computes `v0=` followed by the hex HMAC-SHA256 of the base string

```
v0:<timestamp>:<rawBody>
```

keyed with `slackSigningSecret` from the settings record. Base64-encoded bodies are decoded first. The comparison is a length check followed by `timingSafeEqual`.

Two failure modes return early: no signing secret configured gives `403 Slack not configured`, and a mismatch gives `403 Invalid signature`. Everything after verification returns `200` with the error surfaced as a replacement Slack message, because Slack renders a non-200 as a generic failure the user can't act on.

---

## Approval Path

Once the signature checks out, the handler resolves the tapper's identity through five hops:

1. Slack `users.info` on `payload.user.id` → the approver's **email**. Needs `users:read` and `users:read.email`.
2. `GetItem` on `AccessRequestTable` → the request must still be `PENDING_APPROVAL`, and `request.idcUserEmail` must differ from the approver's email (the self-approval guard; the Slack path compares emails because it has them, unlike the web path).
3. Cognito `ListUsers` filtered on that email → the **Cognito username**, which is the `Snitch::Approver` entity id.
4. Identity Center `ListUsers` + `ListGroupMembershipsForMember` → the approver's **IDC GroupIds**, injected as `Snitch::ApproverGroup` parents. This mirrors what `preTokenGenerationHandler` does for the web path, which is why a group-based approval policy authorizes the same person identically over Slack and the web.
5. AVP `IsAuthorized` on `Snitch::Action::"approve"` for the request's account, with its permission set in context.

On ALLOW it invokes `approveRequest` or `rejectRequest` synchronously via `lambda:InvokeFunction`, passing a synthesized event with the resolved username and group claims — so the same handler, with the same guards, serves both entry points. The comment recorded is a fixed `"Approved via Slack"` or `"Rejected via Slack"`.

Finally it POSTs to `payload.response_url` with `replace_original: true`, swapping the buttons for `✅ Approved by <email>` or `❌ Rejected by <email>` so the message can't be acted on twice.

The Lambda's timeout is 15 seconds against Slack's 3-second acknowledgment budget. Slack shows a timeout warning if the five hops run long, but the decision still lands.

---

## Security Note — No Replay Window

Slack's documented practice is to reject any callback whose `x-slack-request-timestamp` is more than five minutes old, which bounds how long a captured request stays useful. Snitch does not do this: the timestamp is consumed only as part of the signature base string and is never compared against the current clock.

The practical consequence is that a captured `x-slack-signature` and body pair remains valid indefinitely. Anyone able to capture one could replay it later to approve that specific request.

The impact is bounded by the two checks that follow verification — the request must still be `PENDING_APPROVAL`, and the resolved approver must pass AVP — so a replay can only re-drive a decision the same person was already authorized to make, on a request that hasn't been decided or expired. It is not a privilege escalation.

The fix is a few lines in `verifySlackSignature`: reject when `Math.abs(nowSeconds - timestamp) > 300` before computing the HMAC.
