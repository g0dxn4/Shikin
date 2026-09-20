# Shikin — CLAUDE.md

## Project Overview

Local-first personal finance engine. Tauri v2 desktop app + browser-first React SPA. Automation via CLI and MCP — no built-in chat assistant.

## Architecture

```
shikin/
  src/                    # React frontend (19 routed pages)
  src-tauri/              # Tauri v2 desktop shell (Rust)
  cli/                    # CLI + MCP server (Node.js, better-sqlite3)
  packages/finance-core/  # Shared ledger/import/valuation contracts
  skills/                 # Portable AI skill packs distributed by Shikin
```

- **Frontend**: React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **Desktop**: Tauri v2 (Rust)
- **Database**: SQLite via shared storage (`~/.local/share/com.asf.shikin/` on Linux)
- **CLI/MCP**: 108 shared tools via commander CLI + MCP server (113 total CLI commands including `diagnose`, `tools`, `validate`, `web`, `record`)
- **State**: 18 Zustand stores
- **Testing**: Vitest + Testing Library + Playwright (e2e)
- **Package manager**: pnpm 11.1.1 (`packageManager` field). Node.js 24 LTS is what CI and source setup are best tested on. `better-sqlite3@12.8` supports Node 20/22/23/24/25 — do not document Node 18 support.
- **Dead-export analysis**: Fallow remains active via `.fallowrc.json` (`pnpm analyze:fallow`)

## Development

```bash
pnpm install
pnpm dev              # scripts/dev.mjs:
                      # - builds @shikin/finance-core first
                      # - browser data-server on 127.0.0.1:1480
                      # - Vite on 1420
                      # isolated temporary database by default
                      # SHIKIN_BROWSER_USE_REAL_DATA=1 opts into the real app database
pnpm build:tauri      # Build Tauri desktop binary
pnpm test:run         # Unit and integration tests (builds finance-core first)
pnpm check            # Lint + type check + format check (typecheck builds finance-core)
pnpm analyze:fallow   # Unused export/dependency analysis
```

Quality gates are `pnpm check`, `pnpm test:run`, and GitHub Actions CI. Git hooks are not used.

## CLI & MCP Server

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh

shikin list-accounts
shikin add-transaction --amount 5.50 --type expense --description "Coffee"
shikin get-balance-overview
shikin web --port 8480  # loopback-only hosted app; expose privately with Tailscale Serve
shikin mcp

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

### 108 Shared CLI/MCP Tools / 113 CLI Commands

Catalog groups (see `cli/src/tools/index.ts` and `cli/src/fixtures/public-automation-inventory.json`): transactions/corrections/consumption/transfers/tags/placeholders; accounts/categories/reconciliation/coverage; credit cards and payment evidence; budgets/net worth/buckets; investments/subscriptions/bills; receivables; analytics/recaps/forecast/health/goals/debt; category rules; notebook/portfolio review; backup/import/export; audit/undo/sanity; read-only runtime diagnostics; trusted-local plugins.

Use `shikin tools --json` as the authoritative schema/effects inventory; undeclared effects mean unaudited, never implicitly read-only.

### Portable AI Skill

Neutral skill at `skills/shikin-cli-mcp/SKILL.md`. Install with `scripts/install-skill.sh`. Do not add project `.claude/skills` copies.

## Building & Installing

```bash
pnpm build:tauri
# Outputs .deb + .AppImage (Linux amd64), .dmg (macOS), .msi / .exe (Windows)
sudo dpkg -i src-tauri/target/release/bundle/deb/Shikin_*.deb
```

Linux installer scripts publish amd64/x86_64 assets only.

## Releasing & Auto-Updates

Maintainers own tags and GitHub Releases. Do not push tags from agent sessions.

1. Bump versions in: `package.json`, `cli/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`shikin` package entry), and `cli/src/version.ts`
2. Run `pnpm release:preflight` before tagging
3. Tag only after preflight: `git tag vX.X.X && git push origin vX.X.X`
4. GitHub Actions builds, signs, publishes to GitHub Releases
5. Installed apps can detect signed updates via Settings

### Failed release recovery

- Never rewrite or retarget a pushed release tag.
- Fix `main`, bump a fresh patch version, rerun `pnpm release:preflight`, then tag the new version.

### Signing keys (local maintainer machine — never commit)

- Private key: `~/.tauri/shikin.key`
- Public key: `src-tauri/tauri.conf.json` `plugins.updater.pubkey`
- GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Node 24, release preflight → `pnpm check` → unit tests → app/CLI builds → e2e
- **Release** (`.github/workflows/release.yml`): preflight → check → tests → CLI build → cross-platform Tauri sign + publish

Do not claim CI is green until the current run is verified. Fresh e2e previously failed when `finance-core` was not compiled before Playwright; `scripts/dev.mjs` is expected to auto-build it.

## Key Conventions

- Money: INTEGER centavos, converted at boundaries with `toCentavos()`/`fromCentavos()`
- Gross cash flow is the default; net consumption requires explicit classifications and independent source coverage.
- Preserve immutable import/source evidence; metadata correction uses separate audit source/note.
- Staged rows are balance-neutral. Buckets are virtual. Card statement paid amount equals unattributed baseline plus active links.
- Investment ownership and quote identity are explicit. Runtime diagnostics stays read-only and returns no storage paths.
- Coordinate app, CLI, and MCP upgrades after a backup.
- IDs: TEXT (ULIDs via `ulidx`); dates: TEXT (ISO 8601)
- Imports: `@/` → `src/`; React Router v7 from `'react-router'`
- Tailwind v4: CSS-first `@theme`; appearance: native light/dark plus preserved custom themes
- SQL uses `$1, $2` positional params (converted to `?` for better-sqlite3)

## Design System

- Source of truth: `designs/shikin-native-concept/prototype.html` and `DESIGN.md`
- Native light/dark semantic palettes; system-native typography and tabular financial figures
- 216px / 72px desktop rail, six navigation groups, contextual tabs, grouped mobile More sheet
- Shell owns the compact route heading; pages own local actions and filters

## Testing Notes

- Mock `@/lib/database` with `mockReset()` before `mockImplementation()`
- Use `vi.hoisted()` for mock objects referenced in `vi.mock()` factories
- i18n mock: `useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: vi.fn() } })`

## Verification notes (not product claims)

Local verification around this docs cutoff included 1,867 unit/integration tests, 87 browser-suite passes (with expected viewport skips), 27 Rust tests, and the 108-tool packaged smoke. Those numbers are development notes, not marketing badges or reliability guarantees. Do not treat live market-provider or installed native-platform matrices as green unless a current run says so.
