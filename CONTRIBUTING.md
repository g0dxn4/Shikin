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

## Project Guide

For local setup, code conventions, testing notes, and architecture details, see `docs/guides/CONTRIBUTING.md`.
