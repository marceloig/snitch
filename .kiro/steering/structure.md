# Project Structure

## Directory Organization
```
snitch/
├── .amplify/                    # Amplify build artifacts
├── .kiro/steering/             # Kiro steering documents (this file)
├── .vscode/                    # VS Code configuration
├── amplify/                    # AWS Amplify Gen 2 backend
│   ├── auth/
│   │   └── resource.ts         # Cognito authentication configuration
│   ├── data/
│   │   └── resource.ts         # AppSync API & DynamoDB schema
│   ├── backend.ts              # Backend entry point
│   ├── package.json            # Amplify-specific dependencies
│   └── tsconfig.json           # TypeScript config for backend
├── dist/                       # Production build output
├── node_modules/              # Dependencies
├── src/                       # Frontend source code
│   ├── test/                  # Test files
│   │   ├── setup.ts           # Vitest setup (jest-dom matchers)
│   │   └── App.test.tsx      # App component tests
│   ├── App.tsx               # Main application component
│   ├── main.tsx              # Entry point with Amplify config
│   └── vite-env.d.ts         # Vite type definitions
├── .gitignore                 # Git ignore rules
├── amplify_outputs.json       # Generated backend outputs
├── index.html                # HTML entry point
├── package.json              # Project dependencies and scripts
├── tsconfig.json            # Main TypeScript configuration
├── tsconfig.app.json        # App-specific TypeScript config
├── tsconfig.node.json       # Node-specific TypeScript config
├── vite.config.ts           # Vite build configuration
└── README.md                # Project documentation
```

## Key File Purposes

### Backend (`amplify/`)
- **`amplify/backend.ts`**: Main backend definition combining auth and data resources
- **`amplify/data/resource.ts`**: Data model schema (Todo with owner-based auth)
- **`amplify/auth/resource.ts`**: Cognito authentication configuration
- **`amplify_outputs.json`**: Auto-generated backend connection details

### Frontend (`src/`)
- **`src/main.tsx`**: Application entry point with Amplify configuration
- **`src/App.tsx`**: Main application component with Cloudscape UI
- **`src/test/`**: Test files following React Testing Library patterns

### Configuration Files
- **`tsconfig.json`**: Main TypeScript configuration with strict mode
- **`vite.config.ts`**: Vite build tool configuration with React plugin
- **`package.json`**: Project dependencies and npm scripts

## Import Patterns

### Backend Imports
```typescript
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
```

### Frontend Imports
```typescript
// Cloudscape components
import AppLayout from "@cloudscape-design/components/app-layout";
import Table from "@cloudscape-design/components/table";

// Amplify authentication
import { useAuthenticator } from "@aws-amplify/ui-react";

// React hooks
import { useState, useEffect, useCallback } from "react";
```

### Path Aliases
- Use `@/*` for source imports: `import App from "@/App"`
- Configured in `tsconfig.json` and `vite.config.ts`

## Dependencies
- Inject dependencies through constructor/parameter, not globals or module-level imports.
- Wrap third-party libraries (Amplify client, Cloudscape components) behind a thin interface owned by this project when reuse or testing requires it.

## Code Organization Principles

### Component Structure
1. **Main Components**: Place in `src/` root (App.tsx, main.tsx)
2. **Shared Components**: Create `src/components/` directory for reusable components
3. **Utility Functions**: Create `src/utils/` directory for helper functions
4. **Types**: Define types near their usage or in `src/types/` directory

### File Naming Conventions
- **Components**: PascalCase (e.g., `TodoList.tsx`, `UserProfile.tsx`)
- **Utilities**: camelCase (e.g., `formatDate.ts`, `apiClient.ts`)
- **Types**: PascalCase (e.g., `TodoTypes.ts`, `UserTypes.ts`)
- **Tests**: Same name as component with `.test.tsx` suffix

### State Management Pattern
- Use React hooks for local state (`useState`, `useReducer`)
- Use context for global state when needed
- Keep state as close to usage as possible
- Use `useCallback` for memoized functions passed to child components

## Testing Structure
- **Test Files**: Co-located with components or in `src/test/`
- **Test Naming**: `ComponentName.test.tsx`
- **Test Setup**: `src/test/setup.ts` for global test configuration
- **Test Patterns**: Follow React Testing Library best practices

## Module Design
- Prefer small focused modules over large god files.
- Follow the framework's conventions for file placement (components, hooks, utils, types).
- Predictable paths: `src/components/`, `src/hooks/`, `src/utils/`, `src/types/`, `src/test/`.