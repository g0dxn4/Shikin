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

### CLI & MCP Server — 44 Tool Definitions

- **CLI**: `shikin add-transaction --amount 5.50 --type expense --description "Coffee"`
- **MCP Server**: Connect Claude Code, Claude Desktop, Cursor, or any MCP-compatible AI
- **44 Tool Definitions**: 42 end-to-end tools plus 2 structured unavailable compatibility placeholders for external-feed features
- **No Built-in AI**: Bring your own AI — Shikin is the finance engine, your AI platform controls it

### Intelligence & Analytics

- **Dashboard**: Total balance, income/expenses, savings rate, spending trends, category breakdown.
- **Reports & PDF Export**: Monthly/annual reports with dark-themed PDF generation via jsPDF.
- **Spending Heatmap**: Category-based spending intensity visualization.
- **Net Worth Tracking**: Assets vs liabilities with trend over time.
- **Bill Calendar**: Upcoming payments from credit cards, subscriptions, and recurring expenses.
- **Streaks & Achievements**: 8 unlockable badges for financial habits.

### Privacy & Data

- **Fully Local**: No mandatory backend. All data in SQLite via shared storage.
- **In-App Updates**: Tauri desktop app checks GitHub Releases and lets users install signed updates from Settings.
- **Bilingual**: English and Spanish localization (13 i18n namespaces).
- **Database Backup/Restore**: Export and import SQLite snapshots.

---

## Tech Stack

| Layer      | Technology                       | Purpose                                                                                          |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Runtime    | Tauri v2 + Browser + Vite        | Desktop app and web runtime                                                                      |
| Frontend   | React 19 + TypeScript            | UI and application logic                                                                         |
| Styling    | Tailwind CSS v4 + shadcn/ui      | Design system and components                                                                     |
| Routing    | React Router v7                  | Client-side navigation                                                                           |
| State      | Zustand (19 stores)              | Global state management                                                                          |
| Database   | SQLite (shared storage)          | 21 tables, migration-backed schema                                                               |
| Settings   | Tauri Store / data-server bridge | Local key-value config storage                                                                   |
| AI         | CLI (`commander`) + MCP SDK      | Local automation surface (44 shared tool definitions; 2 are structured unavailable placeholders) |
| Forms      | React Hook Form + Zod v4         | Form validation and parsing                                                                      |
| Charts     | Recharts                         | Financial visualizations                                                                         |
| PDF        | jsPDF                            | Report generation                                                                                |
| i18n       | i18next + react-i18next          | Localization (en/es)                                                                             |
| Build/Test | Vite + Vitest + Playwright       | Build pipeline and test tooling                                                                  |

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

## Contribution Flow

Shikin uses a simple two-branch flow for open source work:

- `main` is the stable branch.
- `developer` is the shared testing and integration branch.
- Create feature and fix branches from `developer`.
- Open pull requests into `developer` first.
- After testing, promote `developer` into `main` with a follow-up pull request.

See `CONTRIBUTING.md` for the quick contributor workflow and `docs/guides/CONTRIBUTING.md` for the full development guide.

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

| Command                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`               | Start dev servers (Vite + OAuth + data)                                   |
| `pnpm build`             | Type-check and build production bundle                                    |
| `pnpm build:tauri`       | Build Tauri desktop binary                                                |
| `pnpm preview`           | Preview production build locally                                          |
| `pnpm lint`              | Run ESLint                                                                |
| `pnpm typecheck`         | Run TypeScript checks                                                     |
| `pnpm test`              | Start Vitest in watch mode                                                |
| `pnpm test:run`          | Run unit tests once                                                       |
| `pnpm test:coverage`     | Run unit tests with coverage                                              |
| `pnpm test:ai`           | Run AI integration test script                                            |
| `pnpm release:preflight` | Verify release version parity, updater config, and Tauri plugin alignment |
| `pnpm check`             | Lint + typecheck + format check                                           |

---

## Release Hygiene

- Run `pnpm release:preflight` before creating any release tag.
- CI validates release preflight, lint, typecheck, unit tests, build, and e2e before release promotion.
- The tag-driven release workflow creates a draft GitHub Release first, uploads signed artifacts plus `latest.json`, then publishes only after artifact generation completes.

---

## CLI & MCP Server

Shikin exposes 44 shared CLI/MCP tool definitions. 42 are currently available end-to-end, and 2 compatibility placeholders return structured unavailable responses for external-feed features.

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
│   ├── components/
│   │   ├── layout/           # App shell, sidebar, bottom nav, dialogs
│   │   ├── ui/               # shadcn/ui primitives (21 components)
│   │   ├── transactions/     # Transaction form, dialog, split, import
│   │   ├── goals/            # Goal form, dialog
│   │   ├── budgets/          # Budget form, dialog
│   │   ├── investments/      # Investment form, dialog
│   │   └── accounts/         # Account form, dialog
│   ├── lib/                  # 27 service/utility files
│   │   ├── database.ts       # Dual-backend DB access + migrations
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
│   ├── pages/                # 19 page files, 14 routed
│   ├── stores/               # 19 Zustand stores
│   ├── i18n/                 # 13 namespaces, 2 languages (en/es)
│   └── types/                # TypeScript type definitions
├── cli/                      # CLI + MCP server (44 shared tool definitions; 2 structured unavailable placeholders)
├── docs/                     # Project documentation
├── e2e/                      # Playwright end-to-end tests
└── public/                   # Static assets
```

---

## Documentation

| Document                                       | Description                                       |
| ---------------------------------------------- | ------------------------------------------------- |
| [Architecture](docs/guides/ARCHITECTURE.md)    | Historical browser-first architecture notes       |
| [Backend Map](docs/reference/BACKEND-MAP.md)   | Current CLI, MCP, bridge, and local backend map   |
| [Frontend Map](docs/reference/FRONTEND-MAP.md) | Current routes, stores, dialogs, and frontend map |
| [Database](docs/reference/DATABASE.md)         | 21-table SQLite schema, conventions, migrations   |
| [AI Tools](docs/reference/AI-TOOLS.md)         | Historical frontend AI-agent planning artifact    |
| [Ideas](docs/planning/IDEAS.md)                | Feature ideas backlog with priority tiers         |
| [Contributing](docs/guides/CONTRIBUTING.md)    | Development setup and conventions                 |
| [Roadmap](docs/planning/ROADMAP.md)            | Current roadmap and milestone status              |
| [Changelog](CHANGELOG.md)                      | Recent shipped changes and release notes          |

---

## License

[MIT](LICENSE)

Copyright (c) 2025 ASF
