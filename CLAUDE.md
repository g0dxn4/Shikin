# Valute — CLAUDE.md

## Project Overview

AI-first, local-first personal finance manager. Tauri v2 desktop app + browser-first React SPA.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **Desktop**: Tauri v2 (Rust)
- **Database**: SQLite (sql.js in browser, tauri-plugin-sql in desktop)
- **AI**: Vercel AI SDK v6 with ToolLoopAgent + 43 financial tools
- **State**: Zustand stores
- **Testing**: Vitest + Testing Library + Playwright (e2e)
- **Package Manager**: pnpm

## Development

```bash
pnpm install
pnpm dev              # Vite :1420 + OAuth server :1455 + data-server :1480
pnpm build:tauri      # Build Tauri desktop binary
pnpm test:run         # Unit tests (426 tests, 50 files)
pnpm lint && pnpm typecheck  # Lint + type check
```

## Building & Installing

```bash
pnpm build:tauri
# Outputs:
#   src-tauri/target/release/bundle/deb/Valute_X.X.X_amd64.deb
#   src-tauri/target/release/bundle/appimage/Valute_X.X.X_amd64.AppImage
sudo dpkg -i src-tauri/target/release/bundle/deb/Valute_*.deb
```

## Releasing & Auto-Updates

Tauri updater plugin is configured for automatic update detection via GitHub Releases.

### How to push an update

1. Bump `version` in both `src-tauri/tauri.conf.json` and `package.json`
2. Commit the version bump
3. Tag and push:
   ```bash
   git tag vX.X.X
   git push && git push --tags
   ```
4. GitHub Actions (`.github/workflows/release.yml`) builds for Linux, macOS (arm64 + x86_64), and Windows
5. `tauri-apps/tauri-action` signs the binaries and generates `latest.json` manifest
6. Release is auto-published (not draft)

### How users receive updates

- On app startup, the updater checks `https://github.com/g0dxn4/Valute/releases/latest/download/latest.json`
- If a newer version exists, a toast notification appears with "Restart" button
- Update downloads and installs in the background

### Signing keys

- Private key: `~/.tauri/valute.key` (never commit this)
- Public key: embedded in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`
- GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint → typecheck → unit tests → build → e2e (Playwright)
  - Triggers: push to `main`, pull requests
- **Release** (`.github/workflows/release.yml`): lint → typecheck → tests → cross-platform Tauri build + sign + publish
  - Triggers: `v*` tags

## AI Providers (10)

OpenAI (OAuth + API key), Anthropic, Google Gemini (OAuth + API key), Mistral, xAI, Groq, DeepSeek, Alibaba Qwen, OpenRouter, Ollama (local).

Model lists fetched dynamically from models.dev with static fallbacks in `src/ai/models.ts`.

## Key Conventions

- Money: INTEGER centavos, converted at boundaries with `toCentavos()`/`fromCentavos()`
- IDs: TEXT (ULIDs via `ulidx`)
- Dates: TEXT (ISO 8601)
- Imports: use `@/` path alias (maps to `src/`)
- React Router v7: import from `'react-router'` (not `'react-router-dom'`)
- Tailwind v4: CSS-first `@theme` config, no `tailwind.config.js`
- AI SDK v6: `tool()` uses `inputSchema` (not `parameters`), wrap with `zodSchema()`
- Forced dark mode (no light/dark toggle)
- AI assistant is named **Ivy**

## Design System (ASF)

- Background: `#020202`, Surface: `#0a0a0a`, Accent: `#bf5af2`
- Fonts: Space Grotesk (headings), Outfit (body), Space Mono (mono)
- Brutalist buttons (0px radius), pill badges (9999px), 12px card radius
- Glass morphism: `rgba(10,10,10,0.6)` + `blur(12px)` + border `rgba(255,255,255,0.06)`

## Testing Notes

- Mock `@/lib/database` with `mockReset()` before `mockImplementation()`
- AI SDK tool `execute` returns union type with `AsyncIterable` — cast in tests
- Use `vi.hoisted()` for mock objects referenced in `vi.mock()` factories
- i18n mock: `useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: vi.fn() } })`
