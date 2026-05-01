# Amplify + Cloudscape App

A fullstack application built with **React + Vite**, **AWS Amplify Gen 2**, and **Cloudscape Design System**.

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript
- **UI Components**: [Cloudscape Design System](https://cloudscape.design/)
- **Backend**: AWS Amplify Gen 2 (AppSync, DynamoDB, Cognito)
- **Testing**: Vitest, React Testing Library

## Project Structure

```
├── amplify/                  # Amplify Gen 2 backend
│   ├── auth/
│   │   └── resource.ts       # Cognito auth configuration
│   ├── data/
│   │   └── resource.ts       # AppSync API & DynamoDB schema
│   ├── backend.ts            # Backend entry point
│   └── tsconfig.json
├── src/
│   ├── test/
│   │   ├── setup.ts          # Vitest setup (jest-dom matchers)
│   │   └── App.test.tsx      # App component tests
│   ├── App.tsx               # Main app with Cloudscape UI
│   ├── main.tsx              # Entry point (Amplify config + Authenticator)
│   └── vite-env.d.ts
├── amplify_outputs.json      # Amplify backend outputs (placeholder for local dev)
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Getting Started

### Prerequisites

- Node.js v18.16.0+
- npm v6.14.4+
- AWS account with Amplify access (for backend deployment)

### Install Dependencies

```bash
npm install
```

### Run Frontend Locally

```bash
npm run dev
```

The app starts at [http://localhost:5173](http://localhost:5173).

> **Note**: The included `amplify_outputs.json` contains placeholder values. To connect to a real backend, deploy the Amplify sandbox first (see below).

### Deploy Amplify Cloud Sandbox

Set up AWS credentials, then start a personal cloud sandbox:

```bash
npx ampx sandbox
```

This deploys an isolated backend (Cognito, AppSync, DynamoDB) and updates `amplify_outputs.json` with real connection info. Run this in a separate terminal alongside `npm run dev`.

### Run Tests

```bash
npm run test            # Single run
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

## Backend Resources

| Resource       | Service          | Description                        |
| -------------- | ---------------- | ---------------------------------- |
| Authentication | Amazon Cognito   | Email/password sign-up and sign-in |
| API            | AWS AppSync      | GraphQL API with real-time support |
| Database       | Amazon DynamoDB  | Todo items with owner-based access |

### Data Model

The `Todo` model (`amplify/data/resource.ts`) includes:
- `content` (String) — the todo text
- `done` (Boolean) — completion status
- Owner-based authorization — each user can only access their own todos

## Deployment

Push to a GitHub repo and connect it to [AWS Amplify Hosting](https://docs.amplify.aws/) for CI/CD deployment. Amplify automatically detects the Vite build settings and deploys both frontend and backend.
