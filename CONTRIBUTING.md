# Contributing to Shikin

Thanks for contributing.

## Branch Workflow

- `main` is the stable branch.
- `developer` is the integration branch for reviewed work.
- Create feature branches from `developer` using names like `feature/budget-fixes` or `fix/import-parser`.
- Open pull requests into `developer` first.
- Promote tested changes from `developer` into `main` in a follow-up pull request.

## Before Opening a Pull Request

- Run `pnpm lint`
- Run `pnpm typecheck`
- Run `pnpm test:run`
- Run `pnpm build` if your change affects app behavior or packaging
- Run `pnpm release:preflight` when your change touches release versions, updater config, or the GitHub release flow

## CI and Releases

- CI on `main` runs release preflight, lint, typecheck, unit tests, build, and e2e.
- Create release tags only from tested `main` after `pnpm release:preflight` passes locally.
- The GitHub release workflow creates a draft release first and publishes it only after signed artifacts and `latest.json` finish uploading.

## Project Guide

For local setup, code conventions, testing notes, and architecture details, see `docs/guides/CONTRIBUTING.md`.
