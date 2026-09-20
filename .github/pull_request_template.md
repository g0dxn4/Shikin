## Summary

-

## Testing

Quality gates are local commands plus CI. Git hooks are not used.

- [ ] `pnpm check`
- [ ] `pnpm test:run`
- [ ] `pnpm build` if needed
- [ ] `pnpm release:preflight` if versions, updater config, or release flow changed

## Branch flow

- [ ] Base branch is `main`, and the topic branch includes the latest changes from `main`

## Notes

Do not commit or attach databases, `.env` files, secrets, or unredacted financial exports.

-
