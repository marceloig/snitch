# Snitch — Claude Guidance

## Product Overview

A fullstack todo application demonstrating AWS Amplify Gen 2 integration with Cloudscape Design System.

**Core features:**
- User authentication with Amazon Cognito
- Todo item management (create, read, update, delete)
- Owner-based data isolation (users only see their own todos)
- Responsive UI built with Cloudscape Design System

## Technology Stack

- **Frontend**: React 18 + TypeScript, Vite, Cloudscape Design System
- **Backend**: AWS Amplify Gen 2 (AppSync GraphQL + DynamoDB + Cognito)
- **Testing**: Vitest + React Testing Library (jsdom environment)

### Common Commands

```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Build for production (tsc -b && vite build)
npm run test             # Run tests once
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run sandbox          # Deploy Amplify sandbox
```

## Project Structure

```
snitch/
├── amplify/                    # AWS Amplify Gen 2 backend
│   ├── auth/resource.ts        # Cognito authentication configuration
│   ├── data/resource.ts        # AppSync API & DynamoDB schema
│   └── backend.ts              # Backend entry point
├── src/
│   ├── components/             # Reusable UI components
│   ├── hooks/                  # Custom React hooks
│   ├── utils/                  # Helper functions
│   ├── types/                  # Shared TypeScript types
│   ├── test/
│   │   ├── setup.ts            # Vitest setup (jest-dom matchers)
│   │   └── App.test.tsx
│   ├── App.tsx
│   └── main.tsx                # Entry point with Amplify config
├── amplify_outputs.json        # Generated backend outputs
├── vite.config.ts
└── tsconfig.json
```

## Import Patterns

```typescript
// Amplify data client
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

// Cloudscape — import per-component, not from index
import AppLayout from "@cloudscape-design/components/app-layout";
import Table from "@cloudscape-design/components/table";

// Amplify auth
import { useAuthenticator } from "@aws-amplify/ui-react";

// Src imports use the @/* alias
import App from "@/App";
```

## Code Style

### Functions & Files
- Functions: 4–20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility.
- One responsibility per module; early returns over nested ifs; max 2 levels of indentation.

### Naming
- Names must be specific and unique. Avoid `data`, `handler`, `Manager`.
- Prefer names that return fewer than 5 grep hits in the codebase.
- Components: PascalCase (`TodoList.tsx`). Utilities: camelCase (`formatDate.ts`). Tests: `ComponentName.test.tsx`.

### Types
- Explicit types everywhere. No `any`, no untyped functions.
- TypeScript strict mode is enabled — honor it.

### Duplication
- No code duplication. Extract shared logic into a named function or module.

### Error Messages
```typescript
throw new Error(`Expected Todo id to be a non-empty string, got: ${JSON.stringify(id)}`);
```

### Formatting
- Use Prettier for all formatting.

## Comments
- Write WHY, not WHAT.
- Docstrings on public functions: intent + one usage example.
- Reference issue numbers or commit SHAs when a line exists because of a specific bug or upstream constraint.

## Dependencies & Architecture
- Inject dependencies through constructor/parameter, not globals or module-level imports.
- Wrap third-party libraries (Amplify client, Cloudscape) behind a thin interface when reuse or testing requires it.

## Testing Rules
- Every new function gets a test. Bug fixes get a regression test.
- Mock external I/O (Amplify API, DynamoDB) with named fake classes, not inline stubs.
- Tests must be F.I.R.S.T: fast, independent, repeatable, self-validating, timely.
- Setup file: `src/test/setup.ts`. Test files: `.test.tsx` suffix.

## State Management
- Use React hooks (`useState`, `useReducer`) for local state.
- Use context for global state when needed.
- Keep state as close to usage as possible.
- Use `useCallback` for memoized functions passed to child components.

## Logging
- Structured JSON for debugging and observability (e.g., CloudWatch logs).
- Plain text only for user-facing CLI output.
