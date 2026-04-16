# Release Checklist

Use this checklist when promoting tested changes from `developer` into `main`.

## Before Opening the Promotion PR

- Make sure `developer` is up to date with `origin/developer`.
- Confirm the feature or fix PRs into `developer` are merged.
- Run `pnpm lint`.
- Run `pnpm typecheck`.
- Run `pnpm test:run`.
- Run `pnpm build`.
- Review open bugs or known regressions that should block promotion.

## Promotion Steps

1. Open a pull request from `developer` into `main`.
2. Summarize what is being promoted and call out any risky changes.
3. Wait for CI to pass.
4. Merge only after review.

## After Merge

- Bump all release version locations before tagging:
  - `package.json`
  - `cli/package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  - `cli/src/mcp-server.ts` (`McpServer` version field)
- Run `pnpm release:preflight` after bumping versions and fix any reported issues before tagging.
  - Verifies version parity across `package.json`, `cli/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `cli/src/mcp-server.ts`.
  - Verifies core updater assumptions in `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts`, all updater endpoints, updater `pubkey`).
- Confirm signing prerequisites before creating the tag:
  - Local Tauri private key exists at `~/.tauri/shikin.key` and password is available.
  - `src-tauri/tauri.conf.json` updater `pubkey` matches the private key pair.
  - GitHub Actions secrets are set: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Create and push a release tag from `main` when needed: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Verify the release workflow succeeds for all target platforms.
- Confirm the GitHub Release includes signed updater artifacts, especially `latest.json` and the platform bundles/signatures.
- Install the previous desktop build and confirm Settings can detect the new version before announcing it to users.
- Update roadmap or changelog docs if needed.
