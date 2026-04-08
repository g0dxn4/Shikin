# Shikin

**Your value. Your vault.**

Shikin is an open-source, AI-first, local-first personal finance manager. It runs as a Tauri v2 desktop app or browser-first web app, keeping all data local on your machine.

---

## Why Shikin?

Most personal finance tools force a tradeoff between privacy and intelligence.

Shikin is built to keep both:

- Your finance data stays local (SQLite via shared storage at `~/.local/share/com.asf.shikin/`).
- Settings and preferences are local (settings.json in shared store).
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

### CLI & MCP Server — 43 Tools

- **CLI**: `shikin add-transaction --amount 5.50 --type expense --description "Coffee"`
- **MCP Server**: Connect Claude Code, Claude Desktop, Cursor, or any MCP-compatible AI
- **43 Financial Tools**: Transactions, accounts, budgets, goals, investments, analytics, debt planning, currency conversion, and more
- **No Built-in AI**: Bring your own AI — Shikin is the finance engine, your AI platform controls it

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

- **Fully Local**: No mandatory backend. All data in SQLite via shared storage.
- **Auto-Updates**: Tauri desktop app checks GitHub Releases for updates on startup.
- **Bilingual**: English and Spanish localization (13 i18n namespaces).
- **Database Backup/Restore**: Export and import SQLite snapshots.

---

## Tech Stack

| Layer      | Technology                        | Purpose                             |
| ---------- | --------------------------------- | ----------------------------------- |
| Runtime    | Tauri v2 + Browser + Vite         | Desktop app and web runtime         |
| Frontend   | React 19 + TypeScript             | UI and application logic            |
| Styling    | Tailwind CSS v4 + shadcn/ui       | Design system and components        |
| Routing    | React Router v7                   | Client-side navigation              |
| State      | Zustand (19 stores)               | Global state management             |
| Database   | SQLite (shared storage)           | 21 tables, migration-backed schema  |
| Settings   | Tauri Store / data-server bridge  | Local key-value config storage      |
| AI         | AI SDK v6 (`ai`, `@ai-sdk/react`) | Chat + tool loop runtime (43 tools) |
| Forms      | React Hook Form + Zod v4          | Form validation and parsing         |
| Charts     | Recharts                          | Financial visualizations            |
| PDF        | jsPDF                             | Report generation                   |
| i18n       | i18next + react-i18next           | Localization (en/es)                |
| Build/Test | Vite + Vitest + Playwright        | Build pipeline and test tooling     |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### Installation

```bash
git clone https://github.com/g0dxn4/Shikin.git
cd Shikin
pnpm install
```

### Run Locally

```bash
pnpm dev          # Web mode: Vite :1420 + OAuth :1455 + data-server :1480
```

Then open `http://localhost:1420`.

### Build Desktop App (Tauri)

```bash
pnpm build:tauri  # Builds .deb + .AppImage (Linux), .dmg (macOS), .msi (Windows)
```

### Available Scripts

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Start dev servers (Vite + OAuth + data) |
| `pnpm build`         | Type-check and build production bundle  |
| `pnpm build:tauri`   | Build Tauri desktop binary              |
| `pnpm preview`       | Preview production build locally        |
| `pnpm lint`          | Run ESLint                              |
| `pnpm typecheck`     | Run TypeScript checks                   |
| `pnpm test`          | Start Vitest in watch mode              |
| `pnpm test:run`      | Run unit tests once                     |
| `pnpm test:coverage` | Run unit tests with coverage            |
| `pnpm test:ai`       | Run AI integration test script          |
| `pnpm check`         | Lint + typecheck + format check         |

---

## CLI & MCP Server

Shikin exposes 43 financial tools via CLI and MCP server. Any AI can control your finances.

```bash
cd cli && npm install

# CLI
npx tsx src/cli.ts list-accounts
npx tsx src/cli.ts add-transaction --amount 12.50 --type expense --description "Lunch"
npx tsx src/cli.ts get-spending-summary --period month

# MCP server (for Claude Code, Claude Desktop, Cursor)
npx tsx src/mcp-server.ts
```

### MCP Setup (Claude Desktop)

```json
{
  "mcpServers": {
    "shikin": {
      "command": "npx",
      "args": ["tsx", "/path/to/Shikin/cli/src/mcp-server.ts"]
    }
  }
}
```

## Data Safety

- Export a local backup from **Settings > Data**.
- Import a previously exported backup from the same section.
- Import bank statements (OFX/QFX/QIF) from **Transactions > Import Statement**.
- Backups are SQLite snapshot files (`.db`) for browser-local data recovery/migration.

---

## Project Structure

```
Shikin/
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
