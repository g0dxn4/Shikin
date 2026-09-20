# Contributing to Shikin

Thanks for contributing.

## Branch workflow

- Current development, CI, and GitHub Releases use `main`.
- Create feature branches from `main` using names like `feature/budget-fixes` or `fix/import-parser`.
- Open pull requests against `main`.
- Released versions on GitHub Releases are the install targets. Do not treat `main` as a blanket stable install.

## Before opening a pull request

Quality gates are local commands plus GitHub Actions. Git hooks are not used.

- Run `pnpm check` (lint, typecheck, and format check)
- Run `pnpm test:run`
- Run `pnpm build` if your change affects app behavior or packaging
- Run `pnpm release:preflight` when your change touches release versions, updater config, or the GitHub release flow

Do not attach databases, `.env` files, or real financial exports to issues or pull requests.

## CI and releases

- CI on `main` and pull requests runs release preflight, `pnpm check`, unit tests, app/CLI builds, and e2e.
- Create release tags only from `main` after `pnpm release:preflight` passes locally. Maintainers own tagging and GitHub Releases.
- The GitHub release workflow creates a draft release first and publishes it only after signed artifacts and `latest.json` finish uploading.

## Project guide

Source setup is best tested on **Node.js 24 LTS** and **pnpm 11.1.1**. For local setup, code conventions, testing notes, and architecture details, see `docs/guides/CONTRIBUTING.md`.
