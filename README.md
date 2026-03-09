# Valute

**Your value. Your vault.**

Valute is an open-source, AI-first, local-first personal finance manager built as a native desktop application. Track transactions, budgets, investments, and subscriptions -- all stored locally on your device, with an AI assistant that can read and write your financial data through natural conversation.

<!-- TODO: Add screenshot once UI is complete -->
<!-- ![Valute Dashboard](docs/assets/screenshot-dashboard.png) -->

---

## Why Valute?

Most personal finance tools force you to choose between privacy and intelligence. Cloud-based apps with AI features require you to upload your financial data to third-party servers. Local apps keep your data private but lack smart features.

Valute gives you both. Your data never leaves your machine. The AI runs through your own API keys (OpenAI, Anthropic, or fully local with Ollama), and every query hits your local SQLite database directly.

**Think of it as the Obsidian of personal finance** -- free, local, extensible, with optional paid sync in the future.

---

## Features

- **AI Assistant (Val)** -- Natural language interface for adding transactions, querying spending, and getting financial insights. Powered by tool-calling, not just chat.
- **Persistent Memory** -- Val remembers your preferences, financial goals, and context across conversations using a MemGPT-inspired memory system with automatic conversation compaction.
- **Local-First** -- All data stored in a local SQLite database. No account required. No cloud dependency.
- **Transaction Management** -- Track expenses, income, and transfers across multiple accounts with categories, subcategories, and tags.
- **Budget Tracking** -- Create weekly, monthly, or yearly budgets tied to categories and monitor spending against them.
- **Investment Portfolio** -- Track stocks, ETFs, crypto, bonds, and mutual funds with historical price data.
- **Subscription Management** -- Monitor recurring payments with billing cycle tracking and upcoming payment dates.
- **Multi-Currency** -- Support for USD, EUR, GBP, MXN, BRL, and more with exchange rate tracking.
- **Bilingual** -- Full English and Spanish localization.
- **Extension System** -- Planned plugin architecture for community-built features.
- **Dark Theme** -- Glassmorphism-inspired dark UI built with Tailwind v4 and shadcn/ui.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Tauri v2 | Native window, ~600KB bundle, Rust backend |
| Frontend | React 19 + TypeScript 5.8 | UI rendering |
| Styling | Tailwind CSS v4 + shadcn/ui | Component library and design system |
| Routing | React Router v7 | Client-side navigation |
| State | Zustand 5 | Lightweight global state management |
| Database | SQLite via tauri-plugin-sql | Local data persistence with migrations |
| AI | AI SDK v6 (@ai-sdk/react) | Chat interface with tool calling |
| AI Providers | OpenAI, Anthropic, OpenRouter, Ollama | User-configurable LLM backend |
| Forms | React Hook Form + Zod 4 | Form state and validation |
| Charts | Recharts 3 | Data visualizations |
| i18n | i18next + react-i18next | Internationalization |
| Icons | Lucide React | Icon library |
| IDs | ulidx | Sortable unique identifiers |
| Build | Vite 6 | Frontend bundler with HMR |
| Testing | Vitest 4 + Testing Library | Unit and component tests |
| Linting | ESLint 10 + Prettier 3 | Code quality and formatting |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77.2
- Tauri v2 system dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

### Installation

```bash
# Clone the repository
git clone https://github.com/g0dxn4/Valute.git
cd Valute

# Install dependencies
pnpm install

# Start the development server (launches Tauri + Vite)
pnpm start
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the Tauri desktop app in development mode |
| `pnpm dev` | Start only the Vite frontend dev server (no Tauri) |
| `pnpm build` | Build the frontend for production |
| `pnpm build:tauri` | Build the full Tauri desktop application |
| `pnpm lint` | Run ESLint with zero-warning policy |
| `pnpm lint:fix` | Auto-fix ESLint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting without modifying files |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm check` | Run lint + typecheck + format check |
| `pnpm test` | Run tests in watch mode |
| `pnpm test:run` | Run tests once |
| `pnpm test:coverage` | Run tests with coverage report |

### AI Provider Setup

1. Open the app and navigate to **Settings**.
2. Select your AI provider (OpenAI, Anthropic, OpenRouter, or Ollama).
3. Enter your API key (not needed for Ollama).
4. Select a model or leave blank for the default.

For fully local AI with no API key required, install [Ollama](https://ollama.ai/) and pull a model:

```bash
ollama pull llama3.2
```

---

## Project Structure

```
Valute/
├── src/                      # Frontend source code
│   ├── ai/                   # AI agent, transport, and tool definitions
│   │   ├── tools/            # Individual AI tool implementations (24 tools)
│   │   ├── agent.ts          # ToolLoopAgent configuration
│   │   ├── memory-loader.ts  # System prompt memory injection
│   │   ├── compaction.ts     # Conversation compaction/summarization
│   │   ├── conversation-persistence.ts  # DB persistence for chat
│   │   └── transport.ts      # DirectChatTransport setup
│   ├── components/           # React components
│   │   ├── layout/           # AppShell, Sidebar, AIPanel
│   │   └── ui/               # shadcn/ui components
│   ├── i18n/                 # Internationalization (en, es)
│   ├── lib/                  # Utilities (database, money, ULID)
│   ├── pages/                # Route pages (Dashboard, Transactions, etc.)
│   ├── stores/               # Zustand state stores
│   ├── styles/               # Global CSS (Tailwind)
│   ├── types/                # TypeScript type definitions
│   ├── App.tsx               # Root component with routing
│   └── main.tsx              # Entry point
├── src-tauri/                # Tauri (Rust) backend
│   ├── migrations/           # SQLite migration files
│   ├── src/                  # Rust source (lib.rs, main.rs)
│   └── tauri.conf.json       # Tauri configuration
├── docs/                     # Project documentation
├── public/                   # Static assets
├── package.json
├── vite.config.ts
├── tsconfig.json
└── eslint.config.js
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/guides/ARCHITECTURE.md) | System architecture, component hierarchy, data flow diagrams |
| [Database](docs/reference/DATABASE.md) | Complete SQLite schema, conventions, migrations, example queries |
| [AI Tools](docs/reference/AI-TOOLS.md) | AI tool definitions, schemas, system prompt, tool loop architecture |
| [API](docs/reference/API.md) | Local HTTP API specification for the extension system |
| [Extensions](docs/reference/EXTENSIONS.md) | Extension system design, manifest format, hook points |
| [Contributing](docs/guides/CONTRIBUTING.md) | Setup instructions, code conventions, PR process |
| [Roadmap](docs/planning/ROADMAP.md) | Development roadmap with 10 epics |

---

## Contributing

See [CONTRIBUTING.md](docs/guides/CONTRIBUTING.md) for detailed instructions on setting up the development environment, code conventions, and the pull request process.

---

## License

[MIT](LICENSE)

Copyright (c) 2025 ASF
