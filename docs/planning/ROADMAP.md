# Shikin roadmap

Reviewed against v1.2.1 (`880a70c`) and the unreleased agent-workflow changes on
2026-10-17. This roadmap distinguishes existing behavior from the work in this
branch and future priorities. Release status comes from [CHANGELOG](../../CHANGELOG.md).
The [architecture guide](../guides/ARCHITECTURE.md) describes the current runtimes;
financial data lives in SQLite, with a local hosted bridge or Tauri access.

## Existing capabilities to preserve

| Area                        | Current implementation                                                                                                                | Reference                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Transactions                | Search, category/tag metadata, exact splits, pending/posted status, source-preserving corrections, statement imports and exports      | [Automation workflows](../reference/AUTOMATION-WORKFLOWS.md) |
| Accounts and reconciliation | Account currencies, balances/history, transfer matching, card-payment evidence, dated observations and independent statement coverage | [Backend map](../reference/BACKEND-MAP.md)                   |
| Budgeting and reserves      | Native budget UI and category/account/tag scopes, gross/net reporting, virtual cashflow buckets with allocation corrections           | [Scoped budgets](SCOPED_BUDGETS.md)                          |
| Planning                    | Goals, recurring rules, subscription equivalents, receivables, forecasts and debt payoff views                                        | [Frontend map](../reference/FRONTEND-MAP.md)                 |
| Investments and reports     | Holdings, verified/manual quote evidence, explicit valuation ownership, dated FX and incomplete-total diagnostics                     | [Database reference](../reference/DATABASE.md)               |
| Automation                  | Shared CLI/MCP registry, previewed financial workflows, audit and domain-specific recovery                                            | [Generated inventory](../reference/MCP-TOOL-INVENTORY.md)    |
| User interface              | React native light/dark appearance, responsive navigation, English and Spanish, accessible forms and charts                           | [Design system](../../DESIGN.md)                             |
| Delivery                    | Pinned Node/pnpm setup, lint/type/format checks, synthetic tests, packaged CLI/web smoke and browser CI                               | [Contributing](../guides/CONTRIBUTING.md)                    |

These capabilities should be extended through their shared domain services.
They do not need a second ledger, a replacement category table, or duplicate
monthly reserve transactions.

## Implemented in the current unreleased increment

| Change                    | Result                                                                                                                                              | Contract                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Fixed MCP profiles        | Full compatibility catalog remains the default; opt-in core and read-only modes reduce exposed tools without changing CLI names                     | [MCP design](../research/MCP-DESIGN.md)                     |
| Atomic metadata batches   | One exact preview and apply can correct several transactions; durable retry receipts and all-or-none audit/financial writes                         | [Agent workflows](../reference/AUTOMATION-WORKFLOWS.md)     |
| Budget history            | Explicit monthly captures preserve original definitions and gross/net evidence; corrections append revisions and retrospective captures are labeled | [Budget history](../BUDGET_HISTORY.md)                      |
| Partial received payments | Several posted bank income rows can settle one receivable; immutable receipt evidence, selective reversal and stale-preview checks                  | [Receivable payments](../RECEIVABLE_PAYMENTS.md)            |
| Documentation contracts   | Generated tool inventories, drift check in CI, benchmark harness, updated runtime and upgrade references                                            | [Benchmark and validation](../benchmarks/MCP-BENCHMARKS.md) |

Schema 25/26 requires a coordinated app, CLI and MCP upgrade with a verified
backup. An older release must not write to the upgraded database. See the
[upgrade guide](../guides/AGENT-WORKFLOWS-UPGRADE.md).

## Prioritized next increments

1. **Subcategories and budget assignment:** finish subcategory management and
   matching in budget scopes; add versioned assignment rules and explicit
   overrides with documented precedence. Preserve historical scope and allow
   overlapping analytical budgets without double-counting them as one total.
2. **Optional rollover:** build an explicit period-allocation policy on virtual
   reserves, with opening balances, overspending choices and reasoned revisions.
   Test period boundaries, edited past periods and currencies before enabling
   automatic carryover.
3. **Receipt allocation and historical adjustments:** support one bank payment
   across several invoices and an audited adjustment workflow for preserved
   unattributed legacy receipts. Never fabricate the missing bank evidence.
4. **Live-agent evaluation:** compare full/core/deferred discovery on fixed model
   versions and held-out tasks. Report actual token usage, task completion,
   selection errors and end-to-end latency before changing the default profile.
5. **Protocol and output evolution:** evaluate the newer MCP SDK/specification
   separately, audit remaining tool effects, and narrow domain output schemas
   without breaking existing clients.

Further product ideas and completion criteria are in [Ideas](IDEAS.md).
Historical planning records such as the phase-A FX and earlier remediation
ledgers retain their original scope; they are not current feature inventories.
