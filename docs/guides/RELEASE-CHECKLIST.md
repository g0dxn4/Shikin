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

- Tag a release when needed.
- Verify the release workflow and artifacts if a tag was created.
- Update roadmap or changelog docs if needed.
