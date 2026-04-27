# Frontend Map

Practical map of the current React frontend for hardening and follow-up work.

## 1) Entry points and route/page map

### Runtime entry points

- `src/main.tsx`: applies theme, mounts `<App />`.
- `src/App.tsx`: router setup, lazy page loading, startup side effects.
- `src/components/layout/app-shell.tsx`: shared shell (`Sidebar`, `BottomNav`, global dialogs).

### Startup side effects (`src/App.tsx`)

- `initPriceScheduler()` / `stopPriceScheduler()`
- `useRecurringStore().materializeTransactions()`
- `useCurrencyStore().autoRefreshIfStale()`
- `useAccountStore().fetch()` → `snapshotBalances()`
- `useNetWorthStore().refresh()`
- `checkForUpdates()` (Tauri path)

### Routed pages (current)

| Route                | Page component                    |
| -------------------- | --------------------------------- |
| `/`                  | `src/pages/dashboard.tsx`         |
| `/transactions`      | `src/pages/transactions.tsx`      |
| `/accounts`          | `src/pages/accounts.tsx`          |
| `/budgets`           | `src/pages/budgets.tsx`           |
| `/goals`             | `src/pages/goals.tsx`             |
| `/investments`       | `src/pages/investments.tsx`       |
| `/subscriptions`     | `src/pages/subscriptions.tsx`     |
| `/debt-payoff`       | `src/pages/debt-payoff.tsx`       |
| `/forecast`          | `src/pages/forecast.tsx`          |
| `/net-worth`         | `src/pages/net-worth.tsx`         |
| `/spending-insights` | `src/pages/spending-insights.tsx` |
| `/spending-heatmap`  | `src/pages/spending-heatmap.tsx`  |
| `/settings`          | `src/pages/settings.tsx`          |
| `/bills`             | `src/pages/bills.tsx`             |
| `/reports`           | `src/pages/reports.tsx`           |
| `/extensions`        | `src/pages/extensions.tsx`        |

### Present but not wired in `App.tsx`

- `src/pages/bill-calendar.tsx`
- `src/pages/category-management.tsx`

### Direct page-to-data access (bypassing stores)

| Page                             | Direct calls                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/pages/settings.tsx`         | `lib/storage` (`load`) + `lib/database` (`exportDatabaseSnapshot`, `importDatabaseSnapshot`) |
| `src/pages/forecast.tsx`         | `lib/database` (`query`) inside `useSubscriptions()`                                         |
| `src/pages/spending-heatmap.tsx` | `lib/database` (`query`) for heatmap/category aggregates                                     |

## 2) Dialog/form pattern overview

- Dialog ownership split:
  - **Shell-mounted (`app-shell.tsx`, UI-store owned):** `AccountDialog`, `TransactionDialog`, `BudgetDialog`, `GoalDialog`.
  - **Feature-local (page owned):** `InvestmentDialog` in `src/pages/investments.tsx`; recurring rule dialog component (`RecurringRuleDialog`) in `src/pages/transactions.tsx`; `ConfirmDialog` lazily mounted in feature pages.
- Standard form stack:
  - `react-hook-form`
  - `zod` + `zodResolver`
  - async submit handlers with `isLoading`
  - `sonner` toast success/error feedback
- Edit/new mode is usually driven by `editing*Id` + `key={editingId || 'new'}` to reset form state between modes.

### Form accessibility and validation conventions currently used

- All interactive fields in these forms use explicit `Label` + `htmlFor`/`id` wiring.
- Validation errors are rendered in linked elements with accessibility attributes:
  - `aria-invalid={!!errors.*}` on failing field
  - `aria-describedby={...}` pointing at a stable error id
  - inline error text as `<p id="..." className="text-destructive text-xs" role="alert">...`
- Select fields also use valid trigger ids and expose `aria-invalid` where required.
- Dialog-level blockers are surfaced via `ErrorBanner` where available.

### Error/loading state conventions currently used

- **Form submit buttons:** pass `isLoading` down from dialogs/stores, set `disabled={isLoading}`, and render `...` while saving.
- **Mutations with side-effects:** wrap async calls in `try/finally`, keep delete/primary actions in loading state (for example `isDeleting`), and report results with `sonner` `toast.success` / `toast.error`.
- **Page fetch states:** list pages typically follow this tri-state pattern:
  - `isLoading` → skeleton placeholders
  - cached data + `fetchError` → `ErrorBanner` with optional retry
  - no cached data + `fetchError` → `ErrorState`
- **Empty states:** dedicated empty card/CTA when stores are resolved and empty.

## 3) Zustand store map

| Store file                   | Scope                                                           |
| ---------------------------- | --------------------------------------------------------------- |
| `ui-store.ts`                | Sidebar + dialog open/edit state                                |
| `account-store.ts`           | Accounts CRUD, balance history, daily snapshots                 |
| `transaction-store.ts`       | Transactions CRUD, split transactions, account balance mutation |
| `category-store.ts`          | Category list fetch                                             |
| `budget-store.ts`            | Budgets CRUD + period spend status                              |
| `goal-store.ts`              | Goals CRUD + progress/deadline math                             |
| `investment-store.ts`        | Investments CRUD, latest prices, portfolio summary/history      |
| `subscription-store.ts`      | Subby placeholder state (browser mode unsupported)              |
| `recurring-store.ts`         | Recurring rules CRUD + materialization into transactions        |
| `debt-store.ts`              | Debt strategy planner (snowball/avalanche)                      |
| `forecast-store.ts`          | Cashflow forecast generation + range selection                  |
| `net-worth-store.ts`         | Net worth calc, snapshot, historical chart points               |
| `spending-insights-store.ts` | MoM/YoY spending comparisons + generated insights               |
| `currency-store.ts`          | Preferred currency + exchange-rate cache/refresh                |
| `categorization-store.ts`    | Category suggestions + learned rules                            |
| `anomaly-store.ts`           | Detect/dismiss anomalies + persisted dismissal keys             |
| `health-store.ts`            | Health score + persisted monthly history                        |
| `recap-store.ts`             | Weekly/monthly recap generation + history                       |
| `achievement-store.ts`       | Streaks + unlock/dismiss achievement notifications              |

## 4) Browser bridge/data access usage from the frontend

- Runtime switch: `src/lib/runtime.ts`
  - `isTauri`
  - `DATA_SERVER_URL`
  - `X-Shikin-Bridge` header via `withDataServerHeaders()`
- DB abstraction: `src/lib/database.ts`
  - Browser endpoints: `/api/db/query`, `/api/db/execute`, `/api/db/export`, `/api/db/import`
  - Used by virtually all stores/pages through `query()` / `execute()` / `runInTransaction()`.
- KV/settings abstraction: `src/lib/storage.ts`
  - Browser endpoints: `/api/store/*`
  - Used by currency/settings/anomaly/health flows.
- FS abstraction: `src/lib/virtual-fs.ts`
  - Browser endpoints: `/api/fs/*`
  - Used by notebook-related frontend libs (`src/lib/notebook.ts`, `src/lib/portfolio-review.ts`).

### Bridge/storage dependency inventory (where it is consumed)

- **Startup consumers (`App.tsx`):**
  - `initPriceScheduler()` (background DB/service path)
  - `materializeTransactions`, `autoRefreshIfStale`, `fetchAccounts/snapshotBalances`, `refreshNetWorth` (store-driven DB/storage usage)
- **Page consumers (direct):** `settings`, `forecast` (`useSubscriptions`), `spending-heatmap`.
- **Store consumers:**
  - DB-backed: account, transaction, category, budget, goal, investment, recurring, debt, net-worth, spending-insights.
  - Storage-backed: currency, anomaly, health.
- **Service/background consumers:**
  - DB: `forecast-service`, `anomaly-service`, `recap-service`, `auto-categorize`, `split-service`, `statement-import`, `exchange-rate-service`, `price-scheduler`, `portfolio-review`, `achievement-service`, `health-score-service`.
  - Storage: `price-service`, `news-service`, `achievement-service`, `health-score-service`.
  - Virtual FS: `notebook`, `portfolio-review`.

### Compact feature ownership/dependency map

| Feature                   | Page owner               | Primary state owner                                | Direct data path                               | Runtime boundary                                              |
| ------------------------- | ------------------------ | -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Accounts                  | `pages/accounts.tsx`     | `account-store`                                    | via store → `database`                         | Tauri SQL plugin / browser bridge `/api/db/*`                 |
| Transactions + recurring  | `pages/transactions.tsx` | `transaction-store`, `recurring-store`, `ui-store` | recurring dialog local + stores                | same as above                                                 |
| Investments + prices      | `pages/investments.tsx`  | `investment-store`                                 | `price-service`/`price-scheduler` + DB         | same as above + external price APIs                           |
| Settings (backup + keys)  | `pages/settings.tsx`     | `currency-store` (+ local page state)              | **direct** `database` + `storage`              | Tauri plugin-store/fs or browser `/api/db/*` + `/api/store/*` |
| Notebook/portfolio review | library-driven           | no dedicated store                                 | `virtual-fs` via `notebook`/`portfolio-review` | Tauri fs plugin / browser bridge `/api/fs/*`                  |

## 5) High-risk frontend flows for later hardening

1. **Transaction + account balance integrity** (`transaction-store.ts`, `recurring-store.ts`)  
   Multi-step writes, transfer reversals, split handling, and dependent store refreshes.
2. **Startup side effects race/order** (`App.tsx`)  
   Multiple async jobs run at boot and touch shared state/data.
3. **DB import/export in Settings** (`settings.tsx`, `database.ts`)  
   Full snapshot overwrite + forced reload path.
4. **Bridge dependency handling** (`database.ts`, `storage.ts`, `virtual-fs.ts`)  
   Frontend behavior when local data server is unavailable/misconfigured.
5. **Recurring materialization idempotency** (`recurring-store.ts`)  
   Catch-up loops can create many writes; requires careful duplicate protection.
6. **Notebook virtual-fs path + persistence behavior** (`notebook.ts`, `virtual-fs.ts`, `portfolio-review.ts`)  
   Cross-runtime filesystem semantics and boundary/path assumptions.

## 6) Test coverage overview

- **Frontend unit/integration (Vitest + Testing Library):**
  - Page tests: dashboard, settings, accounts, transactions, budgets, investments.
  - Component tests: dialogs/forms (`account-*`, `transaction-*`, `confirm-dialog`), shell/sidebar, error boundary.
  - Store tests: broad coverage across major stores (`__tests__/*-store.test.ts`).
  - Lib tests: money, ULID, theme, exchange rates, forecasting, anomaly logic, splits, bridge headers, storage failure paths.
- **E2E (Playwright, `e2e/*.spec.ts`):**
  - navigation/layout/dashboard/settings/accounts/transactions/budgets/subscriptions/i18n/responsive.
- **Notably thinner coverage (current):**
  - No dedicated page tests for goals, debt-payoff, forecast, net-worth, spending-insights/heatmap.
  - No dedicated store tests for `budget-store`, `investment-store`, `net-worth-store`, `recap-store`, `spending-insights-store`, `subscription-store`.

### Browser bridge regression coverage (frontend hardening workflow)

- Bridge contract and header tests currently validate:
  - token header propagation for `/api/db`, `/api/store`, and `/api/fs` callers
  - query/export/import token paths in `database`
  - non-OK/error bubbling behavior in `storage` and `virtual-fs`.
- See `src/lib/__tests__/bridge-headers.test.ts`, `src/lib/__tests__/storage.test.ts`, and `src/lib/__tests__/virtual-fs.test.ts`.

## 7) Key file references

- App boot and routing: `src/main.tsx`, `src/App.tsx`, `src/components/layout/app-shell.tsx`
- Route pages: `src/pages/*.tsx`
- Dialog/form examples:
  - `src/components/accounts/account-dialog.tsx`
  - `src/components/accounts/account-form.tsx`
  - `src/components/transactions/transaction-dialog.tsx`
  - `src/components/transactions/transaction-form.tsx`
  - `src/components/shared/confirm-dialog.tsx`
- State layer: `src/stores/*.ts`
- Data access layer:
  - `src/lib/runtime.ts`
  - `src/lib/database.ts`
  - `src/lib/storage.ts`
  - `src/lib/virtual-fs.ts`
- Bridge/header and storage behavior tests:
  - `src/lib/__tests__/bridge-headers.test.ts`
  - `src/lib/__tests__/storage.test.ts`
