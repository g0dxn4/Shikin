# Release Checklist

Use this checklist when preparing a release from reviewed changes on `main`.

## Before Preparing the Release

- Make sure the local `main` branch is up to date with `origin/main`.
- Confirm the intended feature and fix pull requests into `main` are merged.
- Run `pnpm check`.
- Run `pnpm test:run`.
- Run `pnpm build`.
- Review open bugs or known regressions that should block promotion.

## Release Preparation

1. Prepare the version bump and dated `CHANGELOG.md` section on a topic branch from `main`.
2. Summarize the user-visible changes and call out migration or upgrade risks.
3. Open a pull request against `main` and wait for CI to pass.
4. Merge only after review.

## After Merge

- Bump all release version locations before tagging:
  - `package.json`
  - `cli/package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock` (`[[package]] name = "shikin"` version)
  - `cli/src/version.ts` (`APPLICATION_VERSION` literal)
- Run `pnpm release:preflight` after bumping versions and fix any reported issues before tagging.
  - Treat preflight pass as required before creating any release tag.
  - Verifies version parity across `package.json`, `cli/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`shikin`), and `cli/src/version.ts`.
  - Verifies Tauri JS/Rust plugin major/minor parity from `package.json` ↔ `src-tauri/Cargo.lock`.
  - Verifies core updater assumptions in `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts`, all updater endpoints, updater `pubkey`).
- Confirm signing prerequisites before creating the tag:
  - Local Tauri private key exists at `~/.tauri/shikin.key` and password is available.
  - `src-tauri/tauri.conf.json` updater `pubkey` matches the private key pair.
  - GitHub Actions secrets are set: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Commit and push the release preparation, then require a successful `main` CI run for the exact commit being tagged, including E2E tests.
- Run release preflight again as the last local gate, then create and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Verify the release workflow succeeds for all target platforms. It takes release notes from the matching changelog section.
- Before publication, the workflow validates `latest.json` version, all four default updater targets, same-release artifact URLs, signature-file presence, and the CLI source archive/checksum files. This consistency check is not independent cryptographic signature verification.
- Install the previous desktop build and confirm Settings can detect the new version before announcing it to users.
- Update roadmap or changelog docs if needed.

## Failed Release Recovery (Do Not Rewrite Tags)

- Never delete/recreate or retarget a pushed release tag.
- If a release tag fails in CI/CD, fix `main`, bump to a new patch version, rerun `pnpm release:preflight`, then create/push a fresh tag.
  - Example: if `v0.2.2` failed, release `v0.2.3` after fixes.
