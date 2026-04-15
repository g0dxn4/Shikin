# Shikin — CLAUDE.md

## Project Overview

Local-first personal finance engine. Tauri v2 desktop app + browser-first React SPA. AI capabilities exposed via CLI and MCP server — no built-in AI chat.

## Architecture

```
shikin/
  src/           # React frontend (dashboard, transactions, accounts, etc.)
  src-tauri/     # Tauri v2 desktop shell (Rust)
  cli/           # CLI + MCP server (Node.js, better-sqlite3)
```

- **Frontend**: React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **Desktop**: Tauri v2 (Rust)
- **Database**: SQLite via shared storage (`~/.local/share/com.asf.shikin/`)
- **CLI/MCP**: 44 financial tools exposed via commander CLI + MCP server
- **State**: Zustand stores
- **Testing**: Vitest + Testing Library + Playwright (e2e)
- **Package Manager**: pnpm (root) + npm (cli/)

## Development

```bash
pnpm install
pnpm dev              # starts scripts/dev.mjs orchestration:
                      # - OAuth callback server on 127.0.0.1:1455
                      # - browser data-server on 127.0.0.1:1480
                      # - Vite on 1420
                      # per-run bridge token is injected into SHIKIN_DATA_SERVER_BRIDGE_TOKEN / VITE_DATA_SERVER_BRIDGE_TOKEN
pnpm build:tauri      # Build Tauri desktop binary
pnpm test:run         # Unit tests (339 tests, 40 files)
pnpm lint && pnpm typecheck  # Lint + type check
```

## CLI & MCP Server

```bash
cd cli && npm install

# CLI usage
npx tsx src/cli.ts list-accounts
npx tsx src/cli.ts add-transaction --amount 5.50 --type expense --description "Coffee"
npx tsx src/cli.ts get-balance-overview

# MCP server (for Claude Code, Claude Desktop, Cursor, etc.)
npx tsx src/mcp-server.ts
```

### MCP Configuration (Claude Desktop)

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

### 44 Tools Available

Transaction, Account, Category, Analytics, Budget, Goal, Subscription, Investment, Recurring, Memory, Notebook, Intelligence, Debt, Currency tools — all accessible via CLI commands or MCP tool calls.

## Building & Installing

```bash
pnpm build:tauri
# Outputs .deb + .AppImage (Linux), .dmg (macOS), .msi (Windows)
sudo dpkg -i src-tauri/target/release/bundle/deb/Shikin_*.deb
```

## Releasing & Auto-Updates

1. Bump `version` in `src-tauri/tauri.conf.json` and `package.json`
2. Tag and push: `git tag vX.X.X && git push --tags`
3. GitHub Actions builds, signs, publishes to GitHub Releases
4. Installed apps detect updates on startup via toast notification

### Signing keys

- Private key: `~/.tauri/shikin.key` (never commit)
- Public key: in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`
- GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint → typecheck → unit tests → build → e2e
- **Release** (`.github/workflows/release.yml`): lint → typecheck → tests → cross-platform Tauri build + sign + publish

## Key Conventions

- Money: INTEGER centavos, converted at boundaries with `toCentavos()`/`fromCentavos()`
- IDs: TEXT (ULIDs via `ulidx`)
- Dates: TEXT (ISO 8601)
- Imports: use `@/` path alias (maps to `src/`)
- React Router v7: import from `'react-router'` (not `'react-router-dom'`)
- Tailwind v4: CSS-first `@theme` config, no `tailwind.config.js`
- Forced dark mode (no light/dark toggle)
- SQL uses `$1, $2` positional params (converted to `?` for better-sqlite3)

## Design System (ASF)

- Background: `#020202`, Surface: `#0a0a0a`, Accent: `#bf5af2`
- Fonts: Space Grotesk (headings), Outfit (body), Space Mono (mono)
- Brutalist buttons (0px radius), pill badges (9999px), 12px card radius
- Glass morphism: `rgba(10,10,10,0.6)` + `blur(12px)` + border `rgba(255,255,255,0.06)`

## Testing Notes

- Mock `@/lib/database` with `mockReset()` before `mockImplementation()`
- Use `vi.hoisted()` for mock objects referenced in `vi.mock()` factories
- i18n mock: `useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: vi.fn() } })`
