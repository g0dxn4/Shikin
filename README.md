# Valute

**Your value. Your vault.**

Valute is an open-source, AI-first, local-first personal finance manager. It now runs as a browser-first web app while keeping all data local on your machine through in-browser storage.

---

## Why Valute?

Most personal finance tools force a tradeoff between privacy and intelligence.

Valute is built to keep both:

- Your finance data stays local (SQLite via `sql.js`, persisted in IndexedDB).
- Settings and preferences are local (`localStorage`).
- AI uses your own provider keys and works through tool calls against your local database.

---

## Features

- **AI Assistant (Val)**: Natural language finance workflow with tool calling.
- **Persistent Memory**: Preference and context memory with conversation compaction.
- **Local-First Storage**: Browser-based SQLite (`sql.js`) + IndexedDB persistence.
- **Transactions and Accounts**: Full CRUD flows for day-to-day tracking.
- **Budgets, Investments, Subscriptions**: Core pages and AI tools are in place.
- **Multi-provider AI**: OpenAI, Anthropic, OpenRouter, Ollama, Google, Mistral, xAI.
- **Bilingual UI**: English and Spanish localization.

---

## Tech Stack

| Layer      | Technology                        | Purpose                                       |
| ---------- | --------------------------------- | --------------------------------------------- |
| Runtime    | Browser + Vite                    | Local app runtime and bundling                |
| Frontend   | React 19 + TypeScript             | UI and application logic                      |
| Styling    | Tailwind CSS v4 + shadcn/ui       | Design system and components                  |
| Routing    | React Router v7                   | Client-side navigation                        |
| State      | Zustand                           | Global state management                       |
| Database   | SQLite (`sql.js`) + IndexedDB     | Local persistence and migration-backed schema |
| Settings   | `localStorage` wrapper            | Local key-value config storage                |
| AI         | AI SDK v6 (`ai`, `@ai-sdk/react`) | Chat + tool loop runtime                      |
| Forms      | React Hook Form + Zod             | Form validation and parsing                   |
| Charts     | Recharts                          | Financial visualizations                      |
| i18n       | i18next + react-i18next           | Localization                                  |
| Build/Test | Vite + Vitest + Playwright        | Build pipeline and test tooling               |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### Installation

```bash
git clone <your-fork-or-repo-url>
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

For legacy desktop-shell compatibility testing, use `pnpm legacy:tauri:dev` and `pnpm legacy:tauri:build`.

---

## AI Provider Setup

1. Open **Settings** in the app.
2. Choose a provider.
3. Add your API key (not required for Ollama).
4. Pick a model.

For fully local inference:

```bash
ollama pull llama3.2
```

## Data Safety

- Export a local backup from **Settings > Data**.
- Import a previously exported backup from the same section.
- Backups are SQLite snapshot files (`.db`) for browser-local data recovery/migration.

---

## Project Structure

```
Valute/
├── src/
│   ├── ai/                   # Agent, transport, memory, tools
│   ├── components/           # Layout and UI components
│   ├── lib/                  # Database/storage/utilities
│   ├── pages/                # Route pages
│   ├── stores/               # Zustand stores
│   └── i18n/                 # Localization
├── docs/                     # Project documentation
├── public/                   # Static assets
├── e2e/                      # End-to-end tests
└── src-tauri/                # Legacy desktop-shell artifacts
```

---

## Documentation

| Document                                    | Description                                      |
| ------------------------------------------- | ------------------------------------------------ |
| [Architecture](docs/guides/ARCHITECTURE.md) | Runtime layers, data flow, and state model       |
| [Database](docs/reference/DATABASE.md)      | SQLite schema, conventions, and migration notes  |
| [AI Tools](docs/reference/AI-TOOLS.md)      | Val assistant and tool catalog                   |
| [API](docs/reference/API.md)                | Planned local API and extension-facing contracts |
| [Extensions](docs/reference/EXTENSIONS.md)  | Extension system design and capabilities         |
| [Contributing](docs/guides/CONTRIBUTING.md) | Development setup and conventions                |
| [Roadmap](docs/planning/ROADMAP.md)         | Current roadmap and milestone status             |
| [Changelog](CHANGELOG.md)                   | Recent shipped changes and release notes         |

---

## License

[MIT](LICENSE)

Copyright (c) 2025 ASF
