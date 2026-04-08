# Shikin — Research & Strategy Document

> [!IMPORTANT]
> Historical planning document.
> This file captures early strategy and pre-migration architecture exploration.
> The current implementation is browser-first (`sql.js` + IndexedDB + localStorage).
> For up-to-date system details, use `docs/guides/ARCHITECTURE.md`, `docs/guides/CONTRIBUTING.md`, and `README.md`.

**"Your value. Your vault."**

An open-source, local-first, AI-first personal finance manager.

---

## 1. Competitor Analysis

### Direct Competitors (Open Source / Local-First)

| App                  | Stars    | Stack               | AI?     | Investments? | Key Gap Shikin Fills                                       |
| -------------------- | -------- | ------------------- | ------- | ------------ | ---------------------------------------------------------- |
| **Actual Budget**    | 18k+     | Node.js, TypeScript | No      | No           | No AI, no investment tracking, envelope-only budgeting     |
| **Firefly III**      | 17k+     | PHP/Laravel         | No      | No           | Server-heavy, no AI, no investment tracking, complex setup |
| **Maybe Finance**    | 35k+     | Ruby on Rails       | Minimal | Yes (basic)  | Cloud-dependent, not truly local-first, no AI agent        |
| **GnuCash**          | Legacy   | C/GTK               | No      | Yes (basic)  | Ancient UI, steep learning curve, not developer-friendly   |
| **Money Manager Ex** | Moderate | C++                 | No      | Yes          | Desktop-only, no extension system, no API                  |

### AI-First Finance Apps (Proprietary/Cloud)

| App                | Model                   | Local? | Open Source? | Key Limitation                                          |
| ------------------ | ----------------------- | ------ | ------------ | ------------------------------------------------------- |
| **Cleo**           | Proprietary AI chatbot  | No     | No           | Cloud-only, US-focused, requires bank linking via Plaid |
| **MoneyWiz**       | Basic AI categorization | No     | No           | Subscription-based, closed ecosystem                    |
| **Copilot Money**  | AI insights             | No     | No           | Apple-only, cloud-dependent                             |
| **Fidelity Spire** | Goal AI                 | No     | No           | Tied to Fidelity ecosystem                              |

### The Gap Shikin Fills

**No existing app combines ALL of these:**

- Open source + local-first
- AI agent with tool-calling (not just AI categorization)
- Investment portfolio tracking
- Extension/plugin system for community development
- Exposes its own API for inter-app communication
- AI-comprehension-optimized documentation

Shikin is uniquely positioned as the **"Obsidian of personal finance"** — free, local, extensible, with optional paid sync.

---

## 2. Stock Price APIs & Data Sources

### Recommended: Tiered Approach

**Tier 1 — Free (for MVP)**

| API                            | Free Tier   | Best For                      | Notes                                                                 |
| ------------------------------ | ----------- | ----------------------------- | --------------------------------------------------------------------- |
| **Alpha Vantage**              | 25 req/day  | Daily prices, fundamentals    | Best free tier overall, MCP server support, great docs                |
| **Finnhub**                    | 60 req/min  | Real-time quotes, news        | WebSocket support for live prices                                     |
| **Yahoo Finance (unofficial)** | Unlimited\* | Historical data, basic quotes | No official API but `yfinance` Python lib works; unreliable long-term |

**Tier 2 — Freemium (for growth)**

| API                               | Free Tier   | Paid From | Best For                            |
| --------------------------------- | ----------- | --------- | ----------------------------------- |
| **Twelve Data**                   | 800 req/day | $29/mo    | Intraday data, technical indicators |
| **Marketstack**                   | 100 req/mo  | $9/mo     | EOD data, 170k+ tickers             |
| **FMP (Financial Modeling Prep)** | 250 req/day | $14/mo    | Fundamentals + prices combined      |

**Tier 3 — For Mexican Market (BMV)**

| Source            | Access                        | Notes                             |
| ----------------- | ----------------------------- | --------------------------------- |
| **Alpha Vantage** | Supports `.MX` suffix tickers | e.g., `AMXL.MX` for América Móvil |
| **Twelve Data**   | BMV coverage                  | Mexican stock exchange support    |
| **Yahoo Finance** | `.MX` tickers                 | Most reliable for BMV free access |

### Recommended Implementation Strategy

1. **Start with Alpha Vantage** — generous free tier, excellent documentation
2. **Add Finnhub WebSocket** for real-time price updates when app is open
3. **Build a provider-agnostic abstraction layer** so users can plug in any API key
4. **Cache aggressively in SQLite** — stock prices don't need to be real-time for personal finance; daily EOD is sufficient for most users
5. **Let AI agent decide fetch frequency** — daily check for long-term investors, hourly for active traders

---

## 3. Local-First Architecture

### Recommended Stack: Tauri v2 + React + TypeScript + SQLite

```
┌─────────────────────────────────────────────┐
│                TAURI SHELL                   │
│  ┌───────────────────────────────────────┐  │
│  │          FRONTEND (WebView)           │  │
│  │  React + TypeScript + TailwindCSS     │  │
│  │  Vercel AI SDK (tool calling)         │  │
│  │  Recharts (visualizations)            │  │
│  │  shadcn/ui (component library)        │  │
│  └───────────────┬───────────────────────┘  │
│                  │ Tauri IPC (invoke)        │
│  ┌───────────────┴───────────────────────┐  │
│  │         BACKEND (Rust)                │  │
│  │  SQLite via sqlx (data persistence)   │  │
│  │  Local HTTP API (inter-app comms)     │  │
│  │  Stock price fetcher (scheduled)      │  │
│  │  Encryption layer (financial data)    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │                        │
    Local SQLite DB         Local HTTP API
    (encrypted)             (for other apps)
```

### Why This Stack

| Choice                      | Why                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tauri v2**                | ~600KB bundle vs Electron's 100MB+, native performance, Rust security for financial data, cross-platform (Windows/Mac/Linux, mobile coming) |
| **React + TypeScript**      | Largest AI coding ecosystem — Claude Code, Cursor, etc. all work best with React/TS. Maximum community contribution potential               |
| **SQLite via sqlx**         | Zero-config, single-file database, perfect for local-first. sqlx gives type-safe queries in Rust                                            |
| **Vercel AI SDK**           | Provider-agnostic (OpenAI, Anthropic, Ollama for local), built-in tool calling, streaming, TypeScript-native                                |
| **TailwindCSS + shadcn/ui** | AI-friendly styling (utility classes are easy for LLMs to generate), beautiful defaults                                                     |

### Database Schema (Core)

```sql
-- Accounts (bank, cash, investment, credit)
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'bank', 'cash', 'investment', 'credit'
  currency TEXT DEFAULT 'MXN',
  balance REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions (expenses, income)
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  amount REAL NOT NULL,
  type TEXT NOT NULL, -- 'expense', 'income', 'transfer'
  category TEXT,
  subcategory TEXT,
  description TEXT,
  date DATE NOT NULL,
  tags TEXT, -- JSON array
  ai_categorized BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions (synced from external app or manual)
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'MXN',
  frequency TEXT NOT NULL, -- 'monthly', 'yearly', 'weekly'
  next_billing_date DATE,
  category TEXT,
  synced_from TEXT, -- external app source
  active BOOLEAN DEFAULT TRUE
);

-- Investments
CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  name TEXT,
  quantity REAL NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_date DATE NOT NULL,
  current_price REAL,
  last_price_update DATETIME
);

-- Stock price cache
CREATE TABLE stock_prices (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume INTEGER,
  PRIMARY KEY (symbol, date)
);

-- Budgets
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  period TEXT DEFAULT 'monthly',
  start_date DATE
);

-- AI conversation history (for context)
CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL, -- 'user', 'assistant'
  content TEXT NOT NULL,
  tool_calls TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Local HTTP API (Inter-App Communication)

The Rust backend exposes a local API server (e.g., `localhost:7878`):

```
GET  /api/v1/accounts          — List all accounts
GET  /api/v1/transactions      — List transactions (with filters)
GET  /api/v1/subscriptions     — List active subscriptions
GET  /api/v1/investments       — Portfolio summary
GET  /api/v1/summary           — Financial overview (total income, expenses, net worth)
POST /api/v1/transactions      — Add transaction
POST /api/v1/sync/subscriptions — Trigger sync with external subscription app
```

This enables:

- Your subscription app to push data to Shikin
- A future DIY assistant (Alexa-like) to query finances
- Any local AI agent to access financial data via MCP or direct API

---

## 4. AI Agent Architecture

### Approach: Vercel AI SDK + Tool Calling

Rather than a heavy framework (LangChain, CrewAI), use the **Vercel AI SDK** directly in the React frontend with tool definitions. This is lightweight, TypeScript-native, and perfect for a desktop app.

### Why Vercel AI SDK (not LangChain/CrewAI)

| Factor              | Vercel AI SDK                     | LangChain/CrewAI          |
| ------------------- | --------------------------------- | ------------------------- |
| Bundle size         | Tiny (npm package)                | Heavy Python dependencies |
| Language            | TypeScript (same as app)          | Python (separate runtime) |
| Tool calling        | Built-in, type-safe with Zod      | Complex setup             |
| Provider support    | OpenAI, Anthropic, Ollama, Google | Similar                   |
| Local model support | Ollama integration                | Ollama/similar            |
| Learning curve      | Minimal                           | Significant               |
| AI codability       | Excellent (well-documented)       | Moderate                  |

### AI Agent Tools

The AI assistant has access to these tools (defined with Zod schemas):

```typescript
// Tool definitions the AI can call
const tools = {
  // Expense Management
  addTransaction: tool({
    description: 'Add a new expense or income transaction',
    parameters: z.object({
      amount: z.number(),
      type: z.enum(['expense', 'income']),
      category: z.string(),
      description: z.string().optional(),
      date: z.string().optional(), // defaults to today
    }),
    execute: async (params) => {
      /* insert into SQLite */
    },
  }),

  // Query & Analysis
  getSpendingSummary: tool({
    description: 'Get spending summary for a period',
    parameters: z.object({
      period: z.enum(['today', 'week', 'month', 'year']),
      category: z.string().optional(),
    }),
    execute: async (params) => {
      /* query SQLite */
    },
  }),

  // Investment Tracking
  getPortfolioValue: tool({
    description: 'Get current portfolio value and gains/losses',
    execute: async () => {
      /* query investments + latest prices */
    },
  }),

  checkStockPrice: tool({
    description: 'Check current price of a stock',
    parameters: z.object({ symbol: z.string() }),
    execute: async ({ symbol }) => {
      /* fetch from Alpha Vantage */
    },
  }),

  // Budget Management
  checkBudget: tool({
    description: 'Check remaining budget for a category',
    parameters: z.object({ category: z.string() }),
    execute: async ({ category }) => {
      /* query budgets vs spending */
    },
  }),

  // Subscription Management
  getSubscriptions: tool({
    description: 'List all active subscriptions and monthly cost',
    execute: async () => {
      /* query subscriptions table */
    },
  }),

  syncSubscriptions: tool({
    description: 'Sync subscriptions from external app',
    execute: async () => {
      /* call external subscription app API */
    },
  }),
}
```

### AI Provider Strategy

```
Priority 1: Ollama (local, free, private) — llama3, mistral
Priority 2: Anthropic API (Claude) — best for complex reasoning
Priority 3: OpenAI API — GPT-4o for budget option
Priority 4: Any OpenAI-compatible endpoint
```

Users configure their preferred provider in settings. The Vercel AI SDK makes switching providers a one-line change.

### Example AI Interactions

```
User: "I spent 450 pesos on groceries today"
AI: [calls addTransaction({ amount: 450, type: "expense", category: "Groceries" })]
→ "Got it! I've logged 450 MXN for groceries. You've spent 2,340 MXN on groceries
   this month, which is 78% of your 3,000 MXN budget."

User: "How are my investments doing?"
AI: [calls getPortfolioValue()]
→ "Your portfolio is worth $12,450 USD, up 3.2% this month. Your biggest gainer
   is NVDA (+8.4%) and your only loser is INTC (-2.1%)."

User: "How much am I spending on subscriptions?"
AI: [calls getSubscriptions()]
→ "You have 7 active subscriptions totaling 1,890 MXN/month. The biggest are
   Netflix (299 MXN), Spotify (169 MXN), and iCloud (49 MXN)."
```

---

## 5. Extension System

### Plugin Architecture

```
~/.shikin/
├── data/
│   └── shikin.db          # SQLite database
├── extensions/
│   ├── crypto-tracker/    # Community extension
│   │   ├── manifest.json
│   │   └── index.ts
│   └── tax-helper/        # Another extension
│       ├── manifest.json
│       └── index.ts
└── config.toml            # App configuration
```

### Extension Manifest

```json
{
  "name": "crypto-tracker",
  "version": "1.0.0",
  "description": "Track cryptocurrency holdings and prices",
  "author": "community",
  "permissions": ["read:investments", "write:investments", "network:coingecko.com"],
  "tools": [
    {
      "name": "getCryptoPrice",
      "description": "Get current crypto price",
      "parameters": { "symbol": "string" }
    }
  ],
  "ui": {
    "dashboard_widget": "./components/CryptoWidget.tsx",
    "settings_panel": "./components/Settings.tsx"
  }
}
```

Extensions can:

- Add new AI tools (the AI discovers them automatically)
- Add dashboard widgets
- Add new data tables to SQLite
- Register API endpoints
- Add settings panels

---

## 6. Monetization Strategy (Obsidian Model)

| Tier                | Price      | Features                                                     |
| ------------------- | ---------- | ------------------------------------------------------------ |
| **Free (Core)**     | $0         | Full local app, all features, extensions, local AI           |
| **Shikin Sync**     | ~$4-8/mo   | Cloud sync between devices, encrypted backup                 |
| **Shikin Cloud AI** | ~$10-15/mo | Cloud AI processing (no local GPU needed), advanced insights |
| **Donations**       | Optional   | GitHub Sponsors, Open Collective                             |

Revenue grows as user base grows. Core app stays free forever.

---

## 7. Documentation Strategy (AI-Comprehension-Optimized)

Following your documentation system principles:

```
docs/
├── README.md                    # Quick start
├── ARCHITECTURE.md              # System overview
├── CONTRIBUTING.md              # How to contribute
├── api/
│   ├── rest-api.md              # Local HTTP API reference
│   └── ai-tools.md             # AI tool definitions
├── guides/
│   ├── getting-started.md       # First-time setup
│   ├── building-extensions.md   # Extension development
│   └── ai-provider-setup.md    # Configure AI providers
├── reference/
│   ├── database-schema.md       # Complete schema docs
│   ├── extension-manifest.md    # Manifest specification
│   └── configuration.md         # Config file reference
└── decisions/
    └── adr-001-tauri-stack.md   # Architecture Decision Records
```

Key documentation principles:

- Max 4-level heading hierarchy
- kebab-case filenames
- Every file starts with a purpose statement
- Code examples in every reference doc
- "Claude Code friendly" — an AI can read the docs and build features immediately

---

## 8. MVP Feature Scope

### Phase 1 — Core (v0.1)

- [ ] Tauri v2 + React + SQLite scaffolding
- [ ] Basic dashboard with balance overview
- [ ] Manual transaction entry (expense/income)
- [ ] Category management
- [ ] AI chat interface with transaction tools
- [ ] Local HTTP API (basic endpoints)

### Phase 2 — Finance (v0.2)

- [ ] Budget creation and tracking
- [ ] Subscription management
- [ ] External subscription app sync
- [ ] Monthly/weekly/yearly reports
- [ ] Data export (CSV)

### Phase 3 — Investments (v0.3)

- [ ] Portfolio tracking
- [ ] Stock price fetching (Alpha Vantage)
- [ ] Gain/loss calculations
- [ ] AI investment insights

### Phase 4 — Ecosystem (v0.4)

- [ ] Extension system
- [ ] Multiple AI provider support
- [ ] Encrypted database option
- [ ] Sync infrastructure (paid tier)

---

## 9. Key Differentiation Summary

| Feature           | Actual Budget | Firefly III | Cleo        | **Shikin**       |
| ----------------- | ------------- | ----------- | ----------- | ---------------- |
| Open Source       | ✅            | ✅          | ❌          | ✅               |
| Local-First       | ✅            | ❌ (server) | ❌          | ✅               |
| AI Agent          | ❌            | ❌          | ✅ (cloud)  | ✅ (local+cloud) |
| Tool Calling      | ❌            | ❌          | ❌          | ✅               |
| Investments       | ❌            | ❌          | ❌          | ✅               |
| Extension System  | ❌            | Limited     | ❌          | ✅               |
| Inter-App API     | ❌            | ✅          | ❌          | ✅               |
| AI-Optimized Docs | ❌            | ❌          | ❌          | ✅               |
| Desktop Native    | ❌ (web)      | ❌ (web)    | ❌ (mobile) | ✅ (Tauri)       |
