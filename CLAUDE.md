# Shikin — CLAUDE.md

## Project Overview

Local-first personal finance engine. Tauri v2 desktop app + browser-first React SPA. Automation capabilities exposed via CLI and MCP server — no built-in chat assistant.

## Architecture

```
shikin/
  src/           # React frontend (dashboard, transactions, accounts, etc.)
  src-tauri/     # Tauri v2 desktop shell (Rust)
  cli/           # CLI + MCP server (Node.js, better-sqlite3)
  skills/        # Portable AI skill packs distributed by Shikin
```

- **Frontend**: React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **Desktop**: Tauri v2 (Rust)
- **Database**: SQLite via shared storage (`~/.local/share/com.asf.shikin/`)
- **CLI/MCP**: 91 shared CLI/MCP tools via commander CLI + MCP server, all available end-to-end
- **State**: Zustand stores
- **Testing**: Vitest + Testing Library + Playwright (e2e)
- **Package Manager**: pnpm

## Development

```bash
pnpm install
pnpm dev              # starts scripts/dev.mjs orchestration:
                      # - browser data-server on 127.0.0.1:1480
                      # - Vite on 1420
                      # browser development uses a temporary isolated database by default
                      # set SHIKIN_BROWSER_USE_REAL_DATA=1 to opt into the real app database
pnpm build:tauri      # Build Tauri desktop binary
pnpm test:run         # Unit and integration tests
pnpm check            # Lint + type check + format check
```

## CLI & MCP Server

```bash
# Installed desktop app automation support
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh

# Unified desktop-owned CLI
shikin list-accounts
shikin add-transaction --amount 5.50 --type expense --description "Coffee"
shikin get-balance-overview
shikin web --port 8480  # loopback-only hosted app; expose privately with Tailscale Serve
shikin mcp

# Source/dev alternatives
cd cli && pnpm install && pnpm run build
pnpm exec tsx src/cli.ts list-accounts
pnpm exec tsx src/mcp-server.ts
```

### MCP Configuration (Claude Desktop)

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

### 91 Shared CLI/MCP Tools / 96 CLI Commands

Transaction, Account, Category, Analytics, Budget, Goal, Subscription, Investment, Recurring, Notebook, Intelligence, Debt, Currency, Backup/Restore, Audit, and Assistant Context tools — all available end-to-end against local data.

### Portable AI Skill

Shikin distributes a neutral skill at `skills/shikin-cli-mcp/SKILL.md` for AI tools that support file-based skills. Install it with `scripts/install-skill.sh`; keep it portable and do not add project `.claude/skills` copies.

## Building & Installing

```bash
pnpm build:tauri
# Outputs .deb + .AppImage (Linux), .dmg (macOS), .msi (Windows)
sudo dpkg -i src-tauri/target/release/bundle/deb/Shikin_*.deb
```

## Releasing & Auto-Updates

1. Bump release versions in all required files: `package.json`, `cli/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`shikin` package entry), and `cli/src/version.ts`
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

- **CI** (`.github/workflows/ci.yml`): release preflight → `pnpm check` → unit tests → app/CLI builds → e2e
- **Release** (`.github/workflows/release.yml`): release preflight → `pnpm check` → tests → CLI build → cross-platform Tauri app build + sign + publish

## Key Conventions

- Money: INTEGER centavos, converted at boundaries with `toCentavos()`/`fromCentavos()`
- IDs: TEXT (ULIDs via `ulidx`)
- Dates: TEXT (ISO 8601)
- Imports: use `@/` path alias (maps to `src/`)
- React Router v7: import from `'react-router'` (not `'react-router-dom'`)
- Tailwind v4: CSS-first `@theme` config, no `tailwind.config.js`
- Appearance: native light/dark defaults with separately preserved advanced custom themes
- SQL uses `$1, $2` positional params (converted to `?` for better-sqlite3)

## Design System

- Source of truth: `designs/shikin-native-concept/prototype.html` and `DESIGN.md`
- Native light/dark semantic palettes; system-native typography and tabular financial figures
- Solid surfaces, hairline borders, modest radii, restrained shadows, and no heavy blur/glow/grid
- 216px / 72px desktop rail, six navigation groups, contextual tabs, and grouped mobile More sheet
- The shell owns the single compact route heading; pages own local actions and filters
- Saved legacy custom themes and font modes remain available behind advanced appearance controls

## Testing Notes

- Mock `@/lib/database` with `mockReset()` before `mockImplementation()`
- Use `vi.hoisted()` for mock objects referenced in `vi.mock()` factories
- i18n mock: `useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: vi.fn() } })`
