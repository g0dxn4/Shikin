# Shikin — CLAUDE.md

## Project Overview

Local-first personal finance engine. Tauri v2 desktop app + browser-first React SPA. Automation capabilities exposed via CLI and MCP server — no built-in chat assistant.

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
- **CLI/MCP**: 44 shared tool definitions via commander CLI + MCP server (42 available end-to-end + 2 compatibility placeholders)
- **State**: Zustand stores
- **Testing**: Vitest + Testing Library + Playwright (e2e)
- **Package Manager**: pnpm (root) + npm (cli/)

## Development

```bash
pnpm install
pnpm dev              # starts scripts/dev.mjs orchestration:
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

### 44 Tool Definitions

Transaction, Account, Category, Analytics, Budget, Goal, Subscription, Investment, Recurring, Notebook, Intelligence, Debt, Currency tools — available end-to-end, plus compatibility placeholders for external-feed features.

## Building & Installing

```bash
pnpm build:tauri
# Outputs .deb + .AppImage (Linux), .dmg (macOS), .msi (Windows)
sudo dpkg -i src-tauri/target/release/bundle/deb/Shikin_*.deb
```

## Releasing & Auto-Updates

1. Bump release versions in all required files: `package.json`, `cli/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`shikin` package entry), and `cli/src/mcp-server.ts`
2. Run `pnpm release:preflight` before tagging to verify version parity + updater config assumptions (including JS/Rust Tauri plugin major/minor parity)
3. Tag and push only after preflight passes: `git tag vX.X.X && git push origin vX.X.X`
4. GitHub Actions builds, signs, publishes to GitHub Releases
5. Installed apps detect updates on startup via toast notification

### Failed release recovery pattern

- Never rewrite or retarget a pushed release tag.
- If a tagged release fails, fix `main`, bump to a fresh patch version (for example `0.2.2` → `0.2.3`), run `pnpm release:preflight` again, then create/push the new tag.
- Treat preflight as the last local gate before any release tag is created.

### Signing keys

- Private key: `~/.tauri/shikin.key` (never commit)
- Public key: in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`
- GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): release preflight → lint → typecheck → unit tests → build → e2e
- **Release** (`.github/workflows/release.yml`): release preflight → lint → typecheck → tests → cross-platform Tauri build + sign + publish

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
