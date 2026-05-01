# Technology Stack

## Core Technologies
- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Library**: Cloudscape Design System (AWS design system)
- **Backend**: AWS Amplify Gen 2
- **Testing**: Vitest with React Testing Library

## Key Dependencies
### Runtime Dependencies
- `@aws-amplify/ui-react`: Amplify UI components and authentication
- `@cloudscape-design/components`: AWS Cloudscape UI components
- `aws-amplify`: AWS Amplify SDK
- `react` / `react-dom`: React framework

### Development Dependencies
- `@aws-amplify/backend`: Amplify Gen 2 backend definitions
- `@aws-amplify/backend-cli`: Amplify CLI tools
- `vite`: Build tool and dev server
- `vitest`: Test runner
- `@testing-library/react`: React component testing
- `typescript`: TypeScript compiler

## Build System
### Project Structure
- TypeScript configuration in `tsconfig.json` with strict mode enabled
- Vite configuration in `vite.config.ts` with React plugin
- Path alias `@/*` mapped to `./src/*` for cleaner imports

### Common Commands
```bash
# Development
npm run dev              # Start Vite dev server (http://localhost:5173)

# Building
npm run build            # Build for production (tsc -b && vite build)
npm run preview          # Preview production build locally

# Testing
npm run test             # Run tests once
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report

# Backend
npm run sandbox          # Deploy Amplify sandbox (npx ampx sandbox)
```

## AWS Amplify Configuration
### Backend Structure
- **Authentication**: Amazon Cognito (email/password)
- **API**: AWS AppSync GraphQL API
- **Database**: Amazon DynamoDB with owner-based authorization
- **Data Model**: Todo items with `content` (string) and `done` (boolean) fields

### Configuration Files
- `amplify/backend.ts`: Main backend definition
- `amplify/data/resource.ts`: Data model schema
- `amplify/auth/resource.ts`: Authentication configuration
- `amplify_outputs.json`: Generated backend outputs (updated after sandbox deployment)

## Code Style

### Functions & Files
- Functions: 4–20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility.
- One thing per function, one responsibility per module (SRP).
- Early returns over nested ifs. Max 2 levels of indentation.

### Naming
- Names must be specific and unique. Avoid generic names like `data`, `handler`, `Manager`.
- Prefer names that return fewer than 5 grep hits in the codebase.

### Types
- Explicit types everywhere. No `any`, no untyped functions.
- TypeScript strict mode is enabled — honor it.

### Duplication
- No code duplication. Extract shared logic into a named function or module.

### Error Messages
- Exception/error messages must include the offending value and expected shape.
  ```typescript
  throw new Error(`Expected Todo id to be a non-empty string, got: ${JSON.stringify(id)}`);
  ```

### Formatting
- Use Prettier for all formatting. Don't discuss style beyond that.

## Comments
- Write WHY, not WHAT. Skip `// increment counter` above `i++`.
- Docstrings on public functions: intent + one usage example.
- Keep comments on refactor — they carry intent and provenance.
- Reference issue numbers or commit SHAs when a line exists because of a specific bug or upstream constraint.

## Testing Configuration
- Test environment: jsdom for browser-like testing
- Setup file: `src/test/setup.ts` with jest-dom matchers
- Test files: Use `.test.tsx` suffix (e.g., `App.test.tsx`)
- Run all tests: `npm run test`

### Testing Rules
- Every new function gets a test. Bug fixes get a regression test.
- Mock external I/O (Amplify API, DynamoDB) with named fake classes, not inline stubs.
- Tests must be F.I.R.S.T: fast, independent, repeatable, self-validating, timely.

## Code Quality Standards
- **TypeScript**: Strict mode enabled with no unused locals/parameters
- **Imports**: Use path aliases (`@/`) for src imports
- **Components**: Follow Cloudscape Design System patterns
- **State Management**: Use React hooks (useState, useEffect, useCallback)
- **Error Handling**: Implement proper error boundaries and loading states

## Logging
- Structured JSON for debugging and observability (e.g., CloudWatch logs).
- Plain text only for user-facing CLI output.