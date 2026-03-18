# Valute

**Your value. Your vault.**

Valute is an open-source, AI-first, local-first personal finance manager. It runs as a browser-first web app while keeping all data local on your machine through in-browser storage.

---

## Why Valute?

Most personal finance tools force a tradeoff between privacy and intelligence.

Valute is built to keep both:

- Your finance data stays local (SQLite via `sql.js`, persisted in IndexedDB).
- Settings and preferences are local (`localStorage`).
- AI uses your own provider keys and works through tool calls against your local database.

---

## Features

### Core Finance
- **Transactions**: Full CRUD with search, filtering, CSV import, and OFX/QFX/QIF bank statement import.
- **Accounts**: 7 account types (checking, savings, credit card, cash, investment, crypto, other).
- **Budgets**: Category-based budgets with weekly/monthly/yearly periods and progress tracking.
- **Savings Goals**: Target-based goals with deadlines, progress rings, and monthly contribution estimates.
- **Recurring Transactions**: Auto-generated transactions from recurring rules (rent, salary, utilities).
- **Split Transactions**: Split a single payment across multiple categories.
- **Subscriptions**: Track recurring services with billing cycles and costs.
- **Investments**: Portfolio tracking with live prices (Alpha Vantage for stocks, CoinGecko for crypto).
- **Multi-Currency**: Live exchange rates via frankfurter.app with preferred currency conversion.

### AI Assistant (Val) — 43 Tools
- **Natural Language Finance**: Add transactions, query data, manage accounts — all through conversation.
- **Anomaly Detection**: Flags unusual spending, duplicate charges, subscription price changes.
- **Cash Flow Forecasting**: 30/60/90 day projections with danger date warnings.
- **Financial Health Score**: Composite 0-100 score across 5 dimensions with actionable tips.
- **Spending Recaps**: Weekly/monthly natural language summaries with highlights.
- **Debt Payoff Planning**: Snowball vs avalanche strategies with interest savings comparison.
- **Smart Auto-Categorization**: Learns from your corrections to auto-suggest categories.
- **Financial Education**: Contextual tips on budgeting, saving, investing, and debt concepts.
- **Persistent Memory**: MemGPT-inspired system — Val remembers preferences and context across sessions.
- **Research Notebook**: Markdown notes for portfolio reviews, research, and education.

### Intelligence & Analytics
- **Dashboard**: Total balance, income/expenses, savings rate, spending trends, category breakdown.
- **Reports & PDF Export**: Monthly/annual reports with dark-themed PDF generation via jsPDF.
- **Spending Heatmap**: Category-based spending intensity visualization.
- **Net Worth Tracking**: Assets vs liabilities with trend over time.
- **Bill Calendar**: Upcoming payments from credit cards, subscriptions, and recurring expenses.
- **Congressional Trades**: House/Senate stock trading disclosures.
- **Financial News**: Market news via Finnhub and NewsAPI.
- **Streaks & Achievements**: 8 unlockable badges for financial habits.

### Privacy & Data
- **9 AI Providers**: OpenAI, Anthropic, Google, Mistral, xAI, Groq, DeepSeek, OpenRouter, Ollama.
- **Fully Local**: No mandatory backend. All data in IndexedDB + localStorage.
- **Bilingual**: English and Spanish localization (13 i18n namespaces).
- **Database Backup/Restore**: Export and import SQLite snapshots.

---

## Tech Stack

| Layer      | Technology                        | Purpose                                       |
| ---------- | --------------------------------- | --------------------------------------------- |
| Runtime    | Browser + Vite                    | Local app runtime and bundling                |
| Frontend   | React 19 + TypeScript             | UI and application logic                      |
| Styling    | Tailwind CSS v4 + shadcn/ui       | Design system and components                  |
| Routing    | React Router v7                   | Client-side navigation                        |
| State      | Zustand (19 stores)               | Global state management                       |
| Database   | SQLite (`sql.js`) + IndexedDB     | 21 tables, migration-backed schema            |
| Settings   | `localStorage` wrapper            | Local key-value config storage                |
| AI         | AI SDK v6 (`ai`, `@ai-sdk/react`) | Chat + tool loop runtime (43 tools)           |
| Forms      | React Hook Form + Zod v4          | Form validation and parsing                   |
| Charts     | Recharts                          | Financial visualizations                      |
| PDF        | jsPDF                             | Report generation                             |
| i18n       | i18next + react-i18next           | Localization (en/es)                          |
| Build/Test | Vite + Vitest + Playwright        | Build pipeline and test tooling               |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### Installation

```bash
git clone https://github.com/g0dxn4/Valute.git
cd Valute
pnpm install
```

### Run Locally

```bash
pnpm dev
```

Then open `http://localhost:1420`.

### Available Scripts

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `pnpm dev`           | Start Vite dev server                  |
| `pnpm build`         | Type-check and build production bundle |
| `pnpm preview`       | Preview production build locally       |
| `pnpm lint`          | Run ESLint                             |
| `pnpm typecheck`     | Run TypeScript checks                  |
| `pnpm test`          | Start Vitest in watch mode             |
| `pnpm test:run`      | Run unit tests once                    |
| `pnpm test:coverage` | Run unit tests with coverage           |
| `pnpm test:ai`       | Run AI integration test script         |
| `pnpm check`         | Lint + typecheck + format check        |

---

## AI Provider Setup

1. Open **Settings** in the app.
2. Choose a provider (9 available).
3. Add your API key (not required for Ollama).
4. Pick a model.

For fully local inference:

```bash
ollama pull llama3.2
```

## Data Safety

- Export a local backup from **Settings > Data**.
- Import a previously exported backup from the same section.
- Import bank statements (OFX/QFX/QIF) from **Transactions > Import Statement**.
- Backups are SQLite snapshot files (`.db`) for browser-local data recovery/migration.

---

## Project Structure

```
Valute/
├── src/
│   ├── ai/                   # Agent, transport, memory, 43 tools
│   │   ├── agent.ts          # ToolLoopAgent configuration + system prompt
│   │   ├── transport.ts      # DirectChatTransport (no HTTP backend)
│   │   ├── tools/            # 43 AI tool implementations
│   │   └── memory-loader.ts  # MemGPT-style memory system
│   ├── components/
│   │   ├── layout/           # App shell, sidebar, bottom nav, AI panel
│   │   ├── ui/               # shadcn/ui primitives (21 components)
│   │   ├── transactions/     # Transaction form, dialog, split, import
│   │   ├── goals/            # Goal form, dialog
│   │   ├── budgets/          # Budget form, dialog
│   │   ├── investments/      # Investment form, dialog
│   │   └── accounts/         # Account form, dialog
│   ├── lib/                  # 27 service/utility files
│   │   ├── database.ts       # sql.js init, migrations, query/execute
│   │   ├── anomaly-service.ts
│   │   ├── forecast-service.ts
│   │   ├── health-score-service.ts
│   │   ├── recap-service.ts
│   │   ├── debt-service.ts
│   │   ├── education-service.ts
│   │   ├── auto-categorize.ts
│   │   ├── split-service.ts
│   │   ├── statement-parser.ts
│   │   ├── exchange-rate-service.ts
│   │   ├── report-service.ts
│   │   ├── pdf-generator.ts
│   │   ├── achievement-service.ts
│   │   └── ...
│   ├── pages/                # 18 page files, 12 routed
│   ├── stores/               # 19 Zustand stores
│   ├── i18n/                 # 13 namespaces, 2 languages (en/es)
│   └── types/                # TypeScript type definitions
├── docs/                     # Project documentation
├── e2e/                      # Playwright end-to-end tests
└── public/                   # Static assets
```

---

## Documentation

| Document                                    | Description                                          |
| ------------------------------------------- | ---------------------------------------------------- |
| [Architecture](docs/guides/ARCHITECTURE.md) | Runtime layers, data flow, state model, AI tool flow |
| [Database](docs/reference/DATABASE.md)      | 21-table SQLite schema, conventions, migrations      |
| [AI Tools](docs/reference/AI-TOOLS.md)      | 43 tool catalog, system prompt, architecture         |
| [Ideas](docs/planning/IDEAS.md)             | Feature ideas backlog with priority tiers            |
| [Contributing](docs/guides/CONTRIBUTING.md) | Development setup and conventions                    |
| [Roadmap](docs/planning/ROADMAP.md)         | Current roadmap and milestone status                 |
| [Changelog](CHANGELOG.md)                   | Recent shipped changes and release notes             |

---

## License

[MIT](LICENSE)

Copyright (c) 2025 ASF
