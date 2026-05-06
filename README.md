# Shikin

**Your value. Your vault.**

Shikin is an open-source, local-first personal finance manager. It runs as a Tauri v2 desktop app or browser-first web app, keeping all data local on your machine.

---

## Why Shikin?

Most personal finance tools force a tradeoff between privacy and convenience.

Shikin is built to keep both:

- Your finance data stays local (SQLite via shared storage at `~/.local/share/com.asf.shikin/`).
- Settings and preferences are local (settings.json in shared store).
- Automation runs through local CLI and MCP surfaces against your local database.

---

## Features

### Core Finance

- **Transactions**: Full CRUD with search, filtering, CSV import, and OFX/QFX/QIF bank statement import.
- **Accounts**: 7 account types (checking, savings, credit card, cash, investment, crypto, other).
- **Budgets**: Category-based budgets with weekly/monthly/yearly periods and progress tracking.
- **Savings Goals**: Target-based goals with deadlines, progress rings, and monthly contribution estimates.
- **Recurring Transactions**: Auto-generated transactions from recurring rules (rent, salary, utilities).
- **Split Transactions**: Split a single payment across multiple categories.
- **Subscription Insights**: Local subscription data model powering bill forecasts and CLI/MCP analytics.
- **Investments**: Portfolio tracking with live prices (Alpha Vantage for stocks, CoinGecko for crypto).
- **Multi-Currency**: Live exchange rates via frankfurter.app with preferred currency conversion.

### CLI & MCP Server — 39 Tool Definitions

- **CLI**: `shikin add-transaction --amount 5.50 --type expense --description "Coffee"`
- **MCP Server**: Connect Claude Code, Claude Desktop, Cursor, or any MCP-compatible client
- **Portable AI Skill**: Optional `Skill.md` reference for AI tools that support file-based skills
- **39 Tool Definitions**: All shipped CLI/MCP tools run end-to-end against local data
- **No Built-in Chat Assistant**: Shikin is the local finance engine; external clients can automate it through CLI/MCP

Current MVP limitations:

- Recurring transfer rules are not supported yet; one-off transfers work in the app and CLI/MCP.
- Debt payoff estimates default credit-card APR to 0% because account APR is not stored yet, so automatically inferred card payoff projections exclude interest.
- Installment purchases such as meses sin intereses are not first-class yet; record each installment as a recurring or monthly credit-card transaction for now.

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
- **Bilingual**: English and Spanish localization (15 i18n namespaces).
- **Database Backup/Restore**: Export and import SQLite snapshots.

---

## Tech Stack

| Layer      | Technology                       | Purpose                                               |
| ---------- | -------------------------------- | ----------------------------------------------------- |
| Runtime    | Tauri v2 + Browser + Vite        | Desktop app and web runtime                           |
| Frontend   | React 19 + TypeScript            | UI and application logic                              |
| Styling    | Tailwind CSS v4 + shadcn/ui      | Design system and components                          |
| Routing    | React Router v7                  | Client-side navigation                                |
| State      | Zustand (19 stores)              | Global state management                               |
| Database   | SQLite (shared storage)          | 21 tables, migration-backed schema                    |
| Settings   | Tauri Store / data-server bridge | Local key-value config storage                        |
| Automation | CLI (`commander`) + MCP SDK      | Local automation surface (39 shared tool definitions) |
| Forms      | React Hook Form + Zod v4         | Form validation and parsing                           |
| Charts     | Recharts                         | Financial visualizations                              |
| PDF        | jsPDF                            | Report generation                                     |
| i18n       | i18next + react-i18next          | Localization (en/es)                                  |
| Build/Test | Vite + Vitest + Playwright       | Build pipeline and test tooling                       |

---

## Getting Started

### Prerequisites

Released desktop installs do not require developer tools. Optional CLI/MCP automation support requires Node.js and npm. For source setup, install:

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### Installation

Install the latest released desktop app on Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh
```

The helper is interactive by default. It detects your distro, recommends `.deb` on Debian/Ubuntu, `.rpm` on RPM distros, or AppImage elsewhere, then asks what to install. After the desktop app is installed, it asks whether to install optional CLI/MCP automation support. To skip the package prompt and auto-select:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto
```

Sudo is optional. Native `.deb`/`.rpm` packages require admin privileges, but declining the sudo prompt falls back to the AppImage install under `~/Applications`. To skip sudo entirely:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --no-sudo
```

You can force a specific install type:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --deb
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --rpm
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --appimage
```

You can also force or skip CLI/MCP support from the desktop installer:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto --with-cli
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto --no-cli
```

To install CLI/MCP support separately later:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh
```

To install the optional portable AI skill reference for Shikin CLI/MCP usage:

```bash
# Neutral portable copy under Shikin app data
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh

# Install directly into a supported tool's skill directory
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --opencode
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --agents

# Or choose any custom skills root
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --dir ~/.config/my-ai-tool/skills
```

Windows users can install the `.msi` or setup `.exe` from [GitHub Releases](https://github.com/g0dxn4/Shikin/releases/latest). macOS users can install the `.dmg`.

Developer/source setup:

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
pnpm dev          # Web mode: Vite :1420 + data-server :1480
```

Then open `http://localhost:1420`.

### Build Desktop App (Tauri)

```bash
pnpm build:tauri  # Builds .deb + .AppImage (Linux), .dmg (macOS), .msi (Windows)
```

### Available Scripts

| Command                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`               | Start dev servers (Vite + data)                                           |
| `pnpm build`             | Type-check and build production bundle                                    |
| `pnpm build:tauri`       | Build Tauri desktop binary                                                |
| `pnpm preview`           | Preview production build locally                                          |
| `pnpm lint`              | Run ESLint                                                                |
| `pnpm typecheck`         | Run TypeScript checks                                                     |
| `pnpm test`              | Start Vitest in watch mode                                                |
| `pnpm test:run`          | Run unit tests once                                                       |
| `pnpm test:coverage`     | Run unit tests with coverage                                              |
| `pnpm release:preflight` | Verify release version parity, updater config, and Tauri plugin alignment |
| `pnpm check`             | Lint + typecheck + format check                                           |

---

## Release Hygiene

- Run `pnpm release:preflight` before creating any release tag.
- CI validates release preflight, lint, typecheck, unit tests, build, and e2e before release promotion.
- The tag-driven release workflow creates a draft GitHub Release first, uploads signed artifacts plus `latest.json`, then publishes only after artifact generation completes.

---

## CLI & MCP Server

Shikin exposes 39 shared CLI/MCP tool definitions. All shipped tools are available end-to-end against the local database.

```bash
# Install automation support for the installed desktop app.
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh

# The desktop-owned `shikin` command is the user-facing entrypoint.
shikin # open the app
shikin list-accounts
shikin add-transaction --amount 12.50 --type expense --description "Lunch"
shikin get-spending-summary --period month
shikin mcp

# CLI (source/dev alternative)
cd cli && npm install && npm run build
npx tsx src/cli.ts list-accounts
npx tsx src/cli.ts add-transaction --amount 12.50 --type expense --description "Lunch"
npx tsx src/cli.ts get-spending-summary --period month

# MCP server (source/dev alternative)
npx tsx src/mcp-server.ts
```

### MCP Setup (Claude Desktop)

```json
{
  "mcpServers": {
    "shikin": {
      "command": "shikin",
      "args": ["mcp"]
    }
  }
}
```

### AI Skill Pack

Shikin ships a neutral, portable AI skill at `skills/shikin-cli-mcp/SKILL.md`. It documents safe temp-data testing, the unified `shikin` CLI UX, the MCP server command, expected tool counts, resources, and verification commands. It is not tied to one assistant; copy or install it into any file-based skill-capable AI tool.

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --opencode
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --claude
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --agents
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
│   ├── pages/                # 18 routed page files
│   ├── stores/               # 18 Zustand stores
│   ├── i18n/                 # 14 namespaces, 2 languages (en/es)
│   └── types/                # TypeScript type definitions
├── cli/                      # CLI + MCP server (39 shared tool definitions)
├── skills/                   # Portable AI skill packs distributed by Shikin
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
| [Ideas](docs/planning/IDEAS.md)                | Feature ideas backlog with priority tiers         |
| [Contributing](docs/guides/CONTRIBUTING.md)    | Development setup and conventions                 |
| [Roadmap](docs/planning/ROADMAP.md)            | Current roadmap and milestone status              |
| [Changelog](CHANGELOG.md)                      | Recent shipped changes and release notes          |

---

## License

[MIT](LICENSE)

Copyright (c) 2025 ASF
