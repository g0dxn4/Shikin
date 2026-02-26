# Roadmap

This document outlines the development roadmap for Valute, organized into 10 epics. Each epic represents a major feature area with a clear scope, deliverables, and dependencies.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| Done | Completed and merged |
| In Progress | Currently being worked on |
| Planned | Scoped and ready to start |
| Future | Designed but not yet scoped |

---

## Epic 1: Project Scaffolding and Core Infrastructure

**Goal:** Establish the foundation -- build system, database, component library, and development workflow.

| Task | Status | Notes |
|------|--------|-------|
| Initialize Tauri v2 + React 19 + TypeScript project | Done | Vite 6 with HMR |
| Configure Tailwind CSS v4 with custom dark theme | Done | Glassmorphism design |
| Install and configure shadcn/ui component library | Done | 13 components installed |
| Set up ESLint + Prettier with zero-warning policy | Done | Tailwind plugin for class sorting |
| Set up Vitest + Testing Library | Done | jsdom environment |
| Create SQLite schema (migration 001) | Done | 14 tables, 12 indexes, 15 seed categories |
| Implement database access layer (`query`, `execute`) | Done | Singleton connection, typed wrappers |
| Implement money utilities (centavo conversion) | Done | `toCentavos`, `fromCentavos`, `formatMoney` |
| Implement ULID generation | Done | `ulidx` library |
| Set up Zustand stores (UI, AI settings) | Done | `useUIStore`, `useAIStore` |
| Set up i18n with English and Spanish | Done | 4 namespaces per language |
| Create AppShell layout (Sidebar + Main + AI Panel) | Done | Collapsible sidebar, sliding AI panel |
| Configure Tauri CSP for AI provider endpoints | Done | OpenAI, Anthropic, Ollama |
| Set up tauri-plugin-store for encrypted settings | Done | API keys stored locally |
| Set up code splitting with React.lazy | Done | All pages lazy-loaded |
| Implement manual chunk splitting in Vite | Done | vendor-react, vendor-ui, vendor-forms, vendor-utils |
| Set up CI pipeline | Planned | GitHub Actions: lint, typecheck, format, test |

**Dependencies:** None -- this is the foundation.

---

## Epic 2: Transaction Management

**Goal:** Full CRUD for transactions with filtering, sorting, search, and category management.

| Task | Status | Notes |
|------|--------|-------|
| Transaction list page with table/card view | Planned | Paginated, sortable |
| Transaction creation form | Planned | React Hook Form + Zod validation |
| Transaction editing | Planned | Inline or modal edit |
| Transaction deletion with balance reversal | Planned | Confirmation dialog |
| Category and subcategory selector | Planned | Searchable dropdown |
| Date range filtering | Planned | Custom date picker |
| Full-text search on descriptions | Planned | SQLite FTS5 or LIKE |
| Tag management (add, remove, filter by tag) | Planned | JSON array in tags column |
| Transaction import from CSV | Planned | Column mapping UI |
| Transaction export to CSV | Planned | Filtered export |
| Recurring transaction detection | Future | Pattern matching on similar transactions |

**Dependencies:** Epic 1.

---

## Epic 3: Account Management

**Goal:** Multi-account support with balance tracking, transfers, and account-level views.

| Task | Status | Notes |
|------|--------|-------|
| Account list page | Planned | Cards showing name, type, balance |
| Account creation form | Planned | Type selector, initial balance |
| Account editing | Planned | Name, icon, color |
| Account archival (soft delete) | Planned | Hide from active views |
| Account balance history chart | Planned | Recharts line chart |
| Transfer between accounts | Planned | Linked transaction pair |
| Account-scoped transaction view | Planned | Filter transactions by account |
| Multi-currency account support | Planned | Per-account currency setting |
| Net worth calculation | Planned | Assets minus liabilities |
| Credit card balance tracking | Planned | Negative balances, payment tracking |

**Dependencies:** Epic 1.

---

## Epic 4: Budget System

**Goal:** Create and track budgets by category with period-based spending monitoring.

| Task | Status | Notes |
|------|--------|-------|
| Budget list page | Planned | Progress bars showing spent vs. limit |
| Budget creation form | Planned | Category, amount, period |
| Budget editing and deletion | Planned | Adjustable limits |
| Automatic period tracking | Planned | Create budget_period records per week/month/year |
| Budget status calculations | Planned | Spent, remaining, percentage |
| Budget alerts at 80% and 100% thresholds | Planned | Toast notifications |
| Budget vs. actual comparison chart | Planned | Recharts bar chart |
| Rollover budgets | Future | Carry unused amount to next period |
| Budget templates | Future | Quick-create common budget sets |

**Dependencies:** Epic 2 (needs transaction data to calculate spending).

---

## Epic 5: AI Assistant Enhancement

**Goal:** Expand Val's capabilities beyond basic transaction management to comprehensive financial intelligence.

| Task | Status | Notes |
|------|--------|-------|
| `addTransaction` tool | Done | Full implementation with category matching |
| `getSpendingSummary` tool | Done | Period-based spending breakdown |
| `getAccountBalances` tool | Planned | Net worth and per-account balances |
| `getTransactionHistory` tool | Planned | Filtered transaction search |
| `editTransaction` tool | Planned | Modify existing transactions |
| `deleteTransaction` tool | Planned | Delete with confirmation |
| `createBudget` tool | Planned | Budget creation via chat |
| `getBudgetStatus` tool | Planned | Budget progress check |
| `searchTransactions` tool | Planned | Full-text search |
| `getInvestmentPerformance` tool | Planned | Portfolio summary |
| `setReminder` tool | Future | Financial task reminders |
| Conversation persistence to SQLite | Planned | Save/load chat history |
| Multiple conversation threads | Planned | Conversation list in AI panel |
| Conversation title auto-generation | Planned | LLM-generated titles from first message |
| Tool call visualization in chat UI | Planned | Show what tools Val is using |
| Streaming markdown rendering | Planned | Render tables, lists, bold text |
| Context window management | Future | Summarize old messages to fit context |
| Multi-model comparison | Future | Send same query to multiple models |

**Dependencies:** Epic 1 (done). Tool implementations depend on their respective feature epics.

---

## Epic 6: Investment Portfolio Tracking

**Goal:** Track stock, ETF, crypto, and bond holdings with price fetching and performance analytics.

| Task | Status | Notes |
|------|--------|-------|
| Investments list page | Planned | Holdings with current values |
| Investment creation form | Planned | Symbol, shares, cost basis |
| Stock price fetching (Alpha Vantage) | Planned | Daily EOD prices |
| Price caching in stock_prices table | Planned | One record per symbol per day |
| Portfolio value calculation | Planned | Shares * current price |
| Gain/loss calculation (unrealized) | Planned | Market value minus cost basis |
| Portfolio allocation pie chart | Planned | By type, by holding |
| Portfolio performance line chart | Planned | Historical value over time |
| Dividend tracking | Future | Income from holdings |
| Multiple price provider support | Future | Finnhub, Twelve Data, Yahoo Finance |
| Mexican market support (BMV) | Future | `.MX` suffix tickers |
| Crypto price integration (CoinGecko) | Future | Extension or built-in |
| Rebalancing suggestions | Future | AI-powered allocation advice |

**Dependencies:** Epic 3 (investment accounts).

---

## Epic 7: Reporting and Analytics

**Goal:** Comprehensive financial reports with interactive charts and data export.

| Task | Status | Notes |
|------|--------|-------|
| Dashboard overview (total balance, monthly spending, trends) | Planned | Summary cards + charts |
| Monthly spending report | Planned | By category, with month-over-month comparison |
| Income vs. expenses chart | Planned | Stacked bar or area chart |
| Category spending trends over time | Planned | Multi-line chart |
| Cash flow analysis | Planned | Net income/expense per period |
| Top spending categories widget | Planned | Pie or donut chart |
| Spending heatmap (daily view) | Future | Calendar heatmap |
| Custom date range reports | Planned | Date picker + dynamic queries |
| PDF report export | Future | Generate downloadable reports |
| Year-end financial summary | Future | Annual report with key metrics |

**Dependencies:** Epic 2, Epic 3.

---

## Epic 8: Subscription Management

**Goal:** Track recurring payments, predict upcoming bills, and monitor subscription costs.

| Task | Status | Notes |
|------|--------|-------|
| Subscription list page | Planned | Active and cancelled tabs |
| Subscription creation form | Planned | Name, amount, billing cycle, next date |
| Subscription editing and cancellation | Planned | Soft cancel (is_active = 0) |
| Upcoming payments calendar | Planned | Next 30 days view |
| Monthly subscription cost calculation | Planned | Normalize all cycles to monthly |
| Automatic next billing date advancement | Planned | After billing date passes |
| Subscription-to-transaction linking | Future | Auto-create transactions on billing dates |
| Subscription price change detection | Future | Alert when amount differs from expected |
| Subscription cost trends | Future | Monthly cost over time chart |

**Dependencies:** Epic 1.

---

## Epic 9: Extension System

**Goal:** A plugin architecture allowing community developers to extend Valute with new features, AI tools, and UI components.

| Task | Status | Notes |
|------|--------|-------|
| Extension manifest format specification | Done | Documented in EXTENSIONS.md |
| Extension directory scanning and loading | Planned | `~/.valute/extensions/` |
| Manifest validation | Planned | Required fields, version checks |
| Permission model and user approval flow | Planned | Low/medium/high risk levels |
| ExtensionContext API implementation | Planned | data, db, hooks, ai, ui, http |
| Sandboxed database access (`ctx.db`) | Planned | Permission-gated structured queries |
| Sandboxed HTTP access (`ctx.http`) | Planned | Domain-restricted fetch |
| Hook registry and event dispatch | Planned | beforeTransaction, afterTransaction, etc. |
| AI tool registration from extensions | Planned | Dynamic tool registry |
| Dashboard widget rendering | Planned | Extension-provided React components |
| Settings panel rendering | Planned | Extension configuration UI |
| Extension settings page in Valute | Planned | List, enable, disable, remove extensions |
| Extension marketplace (community catalog) | Future | Browse and install from a registry |
| Extension development CLI | Future | Scaffold, validate, package extensions |
| Extension auto-updates | Future | Version checking and upgrade flow |

**Dependencies:** Most of the core features (Epics 1-8) should be stable before shipping the extension API.

---

## Epic 10: Polish, Performance, and Release

**Goal:** Production-quality UX, performance optimization, accessibility, and release distribution.

| Task | Status | Notes |
|------|--------|-------|
| Keyboard shortcuts | Planned | Global shortcuts for common actions |
| Keyboard navigation (full app) | Planned | Tab, arrow keys, Enter |
| ARIA attributes and screen reader support | Planned | shadcn/ui provides a good base |
| Loading states and skeletons | Planned | Suspense boundaries, skeleton components |
| Error states and empty states | Planned | Per-page error/empty illustrations |
| Onboarding flow (first-run wizard) | Planned | Create first account, set currency, configure AI |
| Animation and transitions | Planned | Page transitions, panel animations |
| Performance profiling | Planned | React DevTools, Lighthouse |
| Database query optimization | Planned | Add indexes as needed, batch queries |
| Bundle size optimization | Planned | Tree-shaking audit, lazy imports |
| Automated E2E tests | Future | Tauri WebDriver |
| macOS notarization | Planned | Code signing for distribution |
| Windows code signing | Planned | Certificate for installer |
| Linux packaging (.deb, .AppImage, Flatpak) | Planned | Multiple distribution formats |
| Auto-update system | Future | Tauri updater plugin |
| Crash reporting (opt-in) | Future | Local error logs with optional telemetry |
| User documentation / help pages | Future | In-app help or external docs site |
| Marketing site | Future | Landing page with features and download links |

**Dependencies:** All previous epics.

---

## Release Plan

| Version | Target Epics | Milestone |
|---------|-------------|-----------|
| **v0.1.0** | Epic 1 (done) | Project foundation, scaffolding, AI chat |
| **v0.2.0** | Epic 2, Epic 3 | Transaction and account management |
| **v0.3.0** | Epic 4, Epic 5 | Budgets and expanded AI tools |
| **v0.4.0** | Epic 7 | Dashboard, reporting, and analytics |
| **v0.5.0** | Epic 6 | Investment portfolio tracking |
| **v0.6.0** | Epic 8 | Subscription management |
| **v0.7.0** | Epic 9 | Extension system |
| **v1.0.0** | Epic 10 | Polish, performance, public release |

---

## How to Contribute to the Roadmap

If you want to pick up a task:

1. Check the [Issues](https://github.com/ASF/Valute/issues) page for tasks tagged with the epic label.
2. Comment on the issue to claim it.
3. Follow the [Contributing Guide](CONTRIBUTING.md) for development workflow.

To propose new features or changes to the roadmap, open a Discussion or Issue with the `roadmap` label.
