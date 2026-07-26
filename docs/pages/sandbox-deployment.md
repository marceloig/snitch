---
title: Sandbox Deployment
layout: default
parent: Setup
nav_order: 2
---

# Sandbox Deployment
{: .no_toc }

A sandbox runs the whole Snitch stack — backend and frontend — on your own machine against your own AWS account. Use it to evaluate Snitch or to develop changes before deploying to production. The backend is personal and reloads as you edit it; the frontend runs locally.

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

- **Node.js** v18.16.0 or later.
- Your own **IAM Identity Center application** for the sandbox.

{: .important }
Register a **separate** Identity Center application for your sandbox — don't reuse the production one from [Getting Started]({% link pages/getting-started.md %}#step-1--register-the-iam-identity-center-application). Every environment gets its own sign-in domain and user pool, and therefore its own ACS URL and SAML audience. One application holds only one of each, so pointing it at both environments breaks sign-in for whichever one it isn't currently configured for. Repeat Step 1 to create a second application — `Snitch (sandbox)` — and use its values below.

Then clone and install:

```bash
git clone https://github.com/camarim-cloud/snitch.git
cd snitch
npm install
```

---

## How Authentication Works

Identity Center is the identity provider; Amazon Cognito is the service provider that issues the tokens the app and the API consume.

```
User → App (not signed in)
     → redirect to the Cognito login page
     → user clicks "Sign in with IDC"
     → Cognito redirects to Identity Center → user authenticates
     → Identity Center returns a SAML assertion → Cognito validates it
     → Cognito adds the user's group memberships to the token
       (plus the Admins / Auditors claim when the group matches)
     → tokens issued → user is signed in
```

All configuration comes from plain environment variables read at build time. The SAML metadata URL is public information, so it's supplied the same way as everything else.

---

## Set the Environment Variables

The sandbox reads its configuration from your shell. A template script is tracked in the repository — copy it to a local, git-ignored file, fill in your values, and **source** it:

```bash
cp scripts/set-sandbox-env.example.sh scripts/set-sandbox-env.sh
# edit scripts/set-sandbox-env.sh with your values, then:
source scripts/set-sandbox-env.sh
```

{: .warning }
**Source it — don't execute it.** Running `./scripts/set-sandbox-env.sh` starts a subshell, and its exports vanish when that subshell exits, so the deploy sees none of them. Only `source scripts/set-sandbox-env.sh` (or `. scripts/set-sandbox-env.sh`) sets the variables in the shell you deploy from.

Which variables to set, and what each defaults to in a sandbox, are listed in [Environment Variables]({% link pages/setup.md %}#environment-variables). Use the values from your **sandbox** Identity Center application, not the production one.

{: .note }
Each line in the script uses `export VAR="${VAR:-default}"`, so a value you've already exported wins over the in-file default. Handy for overriding one variable without editing the file.

---

## Deploy the Sandbox

```bash
npm run sandbox   # or: npx ampx sandbox
```

This builds the infrastructure defined under `amplify/`, deploys it to your AWS account, and writes `amplify_outputs.json` with every endpoint and resource id the frontend needs.

{: .note }
The sandbox reloads itself — edits to files under `amplify/` redeploy automatically while `npm run sandbox` is running.

A missing required variable fails the build with a message naming it:

```
[AssemblyError] Environment variable IDC_SAML_METADATA_URL is required for synth-time Cognito config.
```

---

## Run the Frontend

```bash
npm run dev
```

The app starts at [http://localhost:5173](http://localhost:5173).

---

## Point the Identity Center Application at the Sandbox

Your sandbox creates its own user pool, so the placeholder audience from Step 1 needs correcting before sign-in will work. Take the **user pool ID** from `amplify_outputs.json` — it looks like `<REGION>_XXXXXXXXX` — then follow [Getting Started, Step 3a]({% link pages/getting-started.md %}#3a-finalize-the-acs-url-and-saml-audience-uri) against your sandbox application.

---

## Verification

1. Open the app — it should redirect to the login page with a **"Sign in with IDC"** button.
2. Sign in as a user assigned to the sandbox application. The top navigation should show your email.
3. Click **Sign out** — you should land back on the login page rather than being signed straight back in.
4. A user in your admin group can open **Privileged Policies**; anyone else sees **Access denied**. ([How to grant it]({% link pages/getting-started.md %}#3b-grant-admin-access).)
5. A user in your auditor group can open **Approval History** and **Session Activity**. ([How to grant it]({% link pages/getting-started.md %}#3c-grant-auditor-access-optional).)

---

## Changing the Configuration

Update the variable in your shell or in `scripts/set-sandbox-env.sh`, then redeploy:

```bash
export ADMIN_GROUP_ID="<new-group-id>"
source scripts/set-sandbox-env.sh
npm run sandbox
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails with `Environment variable ... is required for synth-time Cognito config.` | A required variable is unset | Set `IDC_SAML_METADATA_URL`, `IDC_IDENTITY_STORE_ID`, and `ADMIN_GROUP_ID` before deploying |
| Sign-in fails with `Audience URI mismatch` | The placeholder audience is still in place | Set the audience to `urn:amazon:cognito:sp:<USER_POOL_ID>` — see [Step 3a]({% link pages/getting-started.md %}#3a-finalize-the-acs-url-and-saml-audience-uri) |
| Sign-in fails with `User not assigned` | The user or their group isn't assigned to the application | Assign them in the Identity Center console |
| An admin sees **Access denied** | `ADMIN_GROUP_ID` doesn't match their group's GroupId, or their token predates the change | Check the GroupId, then sign out and back in |
| An auditor sees **Access denied** | Same, for `AUDITOR_GROUP_ID` | Check the GroupId, then sign out and back in |
| Login page shows **"Login pages unavailable"** | The sign-in domain hasn't finished provisioning | Run `npm run sandbox` — the domain and its branding deploy automatically |
| App hangs on a spinner after redirecting back with `?code=` | Sign-in wasn't started from the app | Always begin from the app's sign-in button, never by opening the login URL directly |
| Signing out signs you straight back in | The session cookie wasn't cleared | Use the app's sign-out button so the logout endpoint runs |
