# Contributing

Thank you for your interest in contributing to Shikin. This document covers the development environment setup, code conventions, testing, and the pull request process.

---

## Prerequisites

Before you begin, make sure you have these tools installed:

| Tool      | Version  | Install                                   |
| --------- | -------- | ----------------------------------------- |
| Node.js   | >= 18    | [nodejs.org](https://nodejs.org/)         |
| pnpm      | >= 9     | `npm install -g pnpm`                     |
| Rust      | Optional | Only needed for legacy desktop-shell work |
| Tauri CLI | Optional | Only needed for legacy desktop-shell work |

The primary workflow is browser-first. Tauri system dependencies are only required if you are actively working on legacy desktop-shell integration.

---

## Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/ASF/Shikin.git
cd Shikin

# 2. Install dependencies
pnpm install

# 3. Start the development environment
pnpm dev
```

`pnpm dev` starts the Vite dev server on `http://localhost:1420` with HMR.

### Legacy Desktop-Shell Development

If you need to test legacy desktop-shell behavior:

```bash
pnpm legacy:tauri:dev
```

`pnpm legacy:tauri:dev` runs `tauri dev` for compatibility testing. Core development does not require this mode.

### Rust Backend Development

The Rust code lives in `src-tauri/`. Changes to Rust files trigger an automatic rebuild when `pnpm legacy:tauri:dev` is running.

To build the Rust backend independently:

```bash
cd src-tauri
cargo build
```

---

## Project Structure

```
src/
├── ai/                   # AI agent, transport, tool definitions
│   ├── tools/            # One file per AI tool
│   ├── agent.ts          # ToolLoopAgent factory
│   └── transport.ts      # DirectChatTransport factory
├── components/
│   ├── layout/           # AppShell, Sidebar, AIPanel
│   └── ui/               # shadcn/ui primitives (button, dialog, etc.)
├── i18n/                 # Internationalization
│   └── locales/          # en/ and es/ JSON translation files
├── lib/                  # Shared utilities
│   ├── database.ts       # SQLite query/execute wrappers
│   ├── money.ts          # Centavo conversion helpers
│   ├── ulid.ts           # ID generation
│   ├── constants.ts      # App constants
│   └── utils.ts          # cn() helper for Tailwind
├── pages/                # One file per route
├── stores/               # Zustand state stores
├── styles/               # Global CSS (Tailwind v4)
├── types/                # TypeScript type definitions
├── App.tsx               # Root component with routing
└── main.tsx              # Entry point
```

---

## Code Conventions

### TypeScript

- **Strict mode** -- `tsconfig.json` uses strict settings. Do not add `any` types; use `unknown` and narrow.
- **Type imports** -- Use `import type` for type-only imports. The ESLint rule `@typescript-eslint/consistent-type-imports` enforces this:
  ```typescript
  import type { Transaction } from '@/types/database'
  ```
- **Path aliases** -- Use `@/` for imports from `src/`:
  ```typescript
  import { query } from '@/lib/database'
  ```

### React

- **Functional components only** -- No class components.
- **Named exports for pages and layout components** -- Default exports are used only for the root `App` component and lazy-loaded pages.
- **Hooks rules** -- The `react-hooks` ESLint plugin enforces the Rules of Hooks.
- **Lazy loading** -- Pages are lazy-loaded with `React.lazy()`:
  ```typescript
  const Dashboard = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.Dashboard })))
  ```

### Styling

- **Tailwind CSS v4** -- All styling uses Tailwind utility classes. No CSS-in-JS or CSS modules.
- **shadcn/ui** -- UI primitives come from shadcn/ui (installed in `src/components/ui/`). Add new components with:
  ```bash
  npx shadcn@latest add <component-name>
  ```
- **Custom classes** -- Custom utility classes (e.g., `glass-sidebar`, `glass-card`, `gradient-text`) are defined in `src/styles/globals.css`.
- **`cn()` helper** -- Use `cn()` from `@/lib/utils` to merge Tailwind classes:
  ```typescript
  className={cn('base-class', isActive && 'active-class')}
  ```
- **Prettier + Tailwind plugin** -- The `prettier-plugin-tailwindcss` plugin automatically sorts Tailwind classes.

### State Management

- **Zustand** -- Global state uses Zustand stores in `src/stores/`.
- **Keep stores small** -- Each store should manage a single concern.
- **No derived state in stores** -- Compute derived values in components or custom hooks.

### Database

- **Money as integers** -- All monetary amounts are stored as centavos (INTEGER). Use `toCentavos()` and `fromCentavos()` from `@/lib/money.ts`.
- **IDs as ULIDs** -- Generate IDs with `generateId()` from `@/lib/ulid.ts`.
- **Parameterized queries** -- Always use `$1`, `$2`, etc. for bind parameters. Never interpolate values into SQL strings.

  ```typescript
  // Good
  await query('SELECT * FROM transactions WHERE account_id = $1', [accountId])

  // Bad -- SQL injection risk
  await query(`SELECT * FROM transactions WHERE account_id = '${accountId}'`)
  ```

### File Naming

| Type       | Convention                            | Example                                         |
| ---------- | ------------------------------------- | ----------------------------------------------- |
| Components | kebab-case `.tsx`                     | `app-shell.tsx`, `loading-spinner.tsx`          |
| Pages      | kebab-case `.tsx`                     | `transactions.tsx`, `settings.tsx`              |
| Utilities  | kebab-case `.ts`                      | `database.ts`, `money.ts`                       |
| Stores     | kebab-case with `-store` suffix       | `ui-store.ts`, `ai-store.ts`                    |
| Types      | kebab-case `.ts`                      | `database.ts`, `common.ts`                      |
| AI Tools   | kebab-case `.ts`                      | `add-transaction.ts`, `get-spending-summary.ts` |
| Tests      | same name with `.test.ts(x)`          | `money.test.ts`, `agent.test.ts`                |
| Migrations | numbered prefix `NNN_description.sql` | `001_core_tables.sql`                           |

---

## Formatting and Linting

### Prettier

Configuration is in `package.json` (defaults) with the Tailwind plugin. Format all files:

```bash
pnpm format
```

Check formatting without modifying files:

```bash
pnpm format:check
```

### ESLint

Configuration is in `eslint.config.js`. Key rules:

| Rule                                         | Setting                      | Purpose                                            |
| -------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `no-console`                                 | warn (allow `warn`, `error`) | Prevent accidental console.log                     |
| `eqeqeq`                                     | error                        | Always use `===`                                   |
| `prefer-const`                               | warn                         | Use `const` when variable is not reassigned        |
| `@typescript-eslint/no-unused-vars`          | warn                         | Catch unused variables (prefix with `_` to ignore) |
| `@typescript-eslint/consistent-type-imports` | warn                         | Enforce `import type`                              |
| `react-refresh/only-export-components`       | warn                         | Ensure HMR works correctly                         |

Run the linter:

```bash
pnpm lint
```

Auto-fix issues:

```bash
pnpm lint:fix
```

### Type Checking

```bash
pnpm typecheck
```

### Run All Checks

```bash
pnpm check
```

This runs `pnpm lint && pnpm typecheck && pnpm format:check`. This is the same check that runs in CI.

## CI

GitHub Actions workflow lives at `.github/workflows/ci.yml` and runs on pushes to `main` and pull requests.

It executes:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:run`
- `pnpm build`

---

## Testing

Tests use **Vitest** with **Testing Library** for component tests and **jsdom** as the test environment.

### Running Tests

```bash
# Watch mode (re-runs on file changes)
pnpm test

# Run once
pnpm test:run

# Run with coverage
pnpm test:coverage
```

### Test File Location

Tests live next to the code they test in `__tests__/` directories:

```
src/lib/
├── __tests__/
│   ├── money.test.ts
│   └── database.test.ts
├── money.ts
└── database.ts
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest'
import { toCentavos, fromCentavos, formatMoney } from '../money'

describe('toCentavos', () => {
  it('converts dollars to centavos', () => {
    expect(toCentavos(12.5)).toBe(1250)
  })

  it('rounds to nearest centavo', () => {
    expect(toCentavos(12.555)).toBe(1256)
  })
})
```

### Mocking Tauri APIs

Since Tauri plugins are not available in the test environment, mock them:

```typescript
import { vi } from 'vitest'

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 }),
    }),
  },
}))
```

---

## Internationalization (i18n)

Shikin supports English and Spanish. Translations live in `src/i18n/locales/`:

```
src/i18n/locales/
├── en/
│   ├── common.json     # Navigation, shared strings
│   ├── dashboard.json  # Dashboard page
│   ├── settings.json   # Settings page
│   └── ai.json         # AI panel
└── es/
    ├── common.json
    ├── dashboard.json
    ├── settings.json
    └── ai.json
```

When adding new user-facing strings:

1. Add the key to the English JSON file.
2. Add the corresponding Spanish translation.
3. Use the `useTranslation` hook in components:
   ```typescript
   const { t } = useTranslation()
   // or for a specific namespace:
   const { t } = useTranslation('dashboard')
   ```

---

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature                                             |
| `fix`      | Bug fix                                                 |
| `docs`     | Documentation only                                      |
| `style`    | Formatting, no code change                              |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                                 |
| `test`     | Adding or fixing tests                                  |
| `build`    | Build system or dependency changes                      |
| `ci`       | CI configuration changes                                |
| `chore`    | Other changes that don't modify src or test files       |

### Scopes

| Scope   | Description                   |
| ------- | ----------------------------- |
| `ai`    | AI agent, tools, transport    |
| `ui`    | Components, layout, styling   |
| `db`    | Database, migrations, queries |
| `i18n`  | Translations                  |
| `store` | Zustand stores                |
| `tauri` | Rust backend, Tauri config    |

### Examples

```
feat(ai): add getAccountBalances tool
fix(db): handle null category_id in spending query
docs: update AI tools documentation
refactor(ui): extract transaction list into separate component
test(ai): add unit tests for addTransaction tool
build: upgrade AI SDK to v6.1
```

---

## Pull Request Process

1. **Create a branch** from `main`:

   ```bash
   git checkout -b feat/account-balances-tool
   ```

2. **Make your changes** following the conventions above.

3. **Run all checks** before pushing:

   ```bash
   pnpm check
   pnpm test:run
   ```

4. **Push and open a pull request** against `main`.

5. **PR description** should include:
   - A summary of what changed and why.
   - Screenshots or recordings for UI changes.
   - Any migration notes if the database schema changed.

6. **Review** -- PRs require at least one approval before merging.

7. **Merge** -- Use squash merge to keep the commit history clean.

---

## Adding a New Page

1. Create the page component in `src/pages/`:

   ```typescript
   // src/pages/reports.tsx
   export function Reports() {
     return <div>Reports page</div>
   }
   ```

2. Add the lazy import and route in `src/App.tsx`:

   ```typescript
   const Reports = lazy(() =>
     import('@/pages/reports').then((m) => ({ default: m.Reports }))
   )

   // Inside <Routes>:
   <Route path="/reports" element={<Reports />} />
   ```

3. Add the navigation link in `src/components/layout/sidebar.tsx`:

   ```typescript
   { path: '/reports', icon: BarChart3, labelKey: 'nav.reports' },
   ```

4. Add the translation keys in both `en/common.json` and `es/common.json`.

---

## Adding a New AI Tool

See the detailed guide in [AI-TOOLS.md](../reference/AI-TOOLS.md#adding-a-new-tool).

---

## Adding a Database Migration

See the migration guide in [DATABASE.md](../reference/DATABASE.md#migration-strategy).
