# Automation Workflows

This reference captures the generic CLI/MCP finance workflows added or hardened by the assistant-safe workflow plan. The features are for any human, script, CLI user, MCP client, bot, or AI assistant. Shikin does not hardcode a specific assistant, Discord bot, or source label.

Use `shikin tools --json` as the authoritative machine-readable contract. At the time of this update, Shikin exposes 83 shared CLI/MCP tools and 87 total CLI commands including CLI-only built-ins.

## Provenance And Notes

- `source` is an opaque provenance label such as `manual`, `csv-import`, `mcp`, `scheduled-script`, `discord-bot`, or another automation name. Shikin stores it for audit/search context; it is not a trusted identity and does not enable product-specific behavior.
- `note` is an audit/changelog note for the workflow operator.
- `notes` are transaction-facing details stored on the transaction itself.
- Write workflows that mutate finance data should be used dry-run-first when available and should include `source`/`note` when automation is involved.

## Added And Hardened Workflows

| Workflow | What changed |
| --- | --- |
| `record-card-payment` | Records card payments as transfers, cleanup expenses, or statement-only updates. Dry-runs include balance impact, statement impact, duplicate warnings, and audit previews. Duplicate writes are blocked unless `--allow-duplicate` is explicit. |
| `credit-card-cycle-explain` | Explains statement cycle dates, latest statement due date, next upcoming due date, and optional purchase-date classification without ambiguous `nextPaymentDueDate` wording. |
| Placeholder transactions | `create-placeholder-transaction`, `list-placeholder-transactions`, `resolve-placeholder-transaction`, and `split-placeholder-transaction` support unknown charges with balance previews, audit provenance, and lifecycle metadata. |
| Strict record parsing | `record --strict` rejects ambiguous natural-language entries instead of guessing. It returns stable machine-readable failures such as `AMBIGUOUS_RECORD_PARSE`, `DUPLICATE_TRANSACTION`, and `POTENTIAL_DUPLICATE_TRANSACTION`. |
| Balance previews | Transaction writes in scope return centavo-based `balanceImpact` previews. Pending transactions are explicitly non-impacting. |
| Duplicate detection | Entry-time writes block exact and potential duplicates unless `--allow-duplicate` is used. `finance-sanity-check` now reuses the shared duplicate engine for review-time duplicate-looking findings. |
| Tags and projects | `tag-transaction`, `untag-transaction`, `list-tags`, and `query-transactions --tag` provide project-style labels through transaction tags. There is no separate project entity. |
| Subscription from transaction | `create-subscription-from-transaction` derives a subscription from an existing expense or income, supports overrides, rejects transfers, and records audit provenance. |
| Undo and rollback | `undo` is dry-run-first, supports filters such as source, command, account, transaction, statement, and audit id, blocks dependent writes by default, and records an undo audit entry when applied. |
| Finance sanity check | `finance-sanity-check` is the neutral daily-review command for due statements, unresolved placeholders, duplicate-looking transactions, upcoming bills, low balances, balance mismatches, hygiene issues, high Other Expenses, and recent provenance-tagged writes. |

## Persistence And Documentation Updates

- `src-tauri/migrations/018_placeholder_transactions.sql` records the placeholder transaction schema history as an additive SQLite migration artifact.
- `docs/reference/DATABASE.md` now documents `audit_log`, `credit_card_statements`, placeholder transaction columns, and related indexes.
- Placeholder self-reference columns are logical/application-level references. Runtime migrations add them as plain `TEXT` columns because SQLite cannot add physical self-referential foreign keys with `ALTER TABLE ADD COLUMN`.

## Validation And Smoke Coverage

The plan added or tightened coverage for:

- CLI catalog and option-contract stability for the workflow commands.
- MCP registration of the workflow tools.
- Card payment duplicate blocking, alias resolution, statement impact, and audit previews.
- Strict `record` ambiguity, stable errors, source/note forwarding, and duplicate blocking.
- Finance sanity exact and fuzzy duplicate wrapper behavior.
- Real SQLite parameter binding for tag filters and transaction hygiene queries.
- Subscription-from-transaction validation and undo apply balance reversal.
- Isolated dist CLI/MCP smoke tests against temporary SQLite databases under `XDG_DATA_HOME=/tmp/opencode/...`.

Recent hard smoke coverage exercised catalog discovery, strict record failure, transaction dry-run/apply, duplicate block/override, placeholders, tags/query, subscription-from-transaction, undo preview, finance sanity, credit-card cycle explanation, card payment dry-run, and MCP registration without touching the real user database.

## Operational Guidance

- Prefer `--dry-run` before writes and review `balanceImpact`, duplicate warnings, and audit previews.
- Use explicit account ids, aliases, or exact names when multiple accounts could match.
- Use `--allow-duplicate` only when a duplicate warning is expected and intentional.
- Use `--redacted` or tool-level `redacted: true` before sharing finance output in logs or transcripts.
- Use `shikin diagnose --deep` before MCP sessions when checking database readiness.
