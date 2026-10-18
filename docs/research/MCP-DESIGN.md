# MCP architecture decision and research

Research date: 2026-10-17. Baseline: `880a70c` (`v1.2.1`).

## Decision

Keep one shared domain-tool registry for CLI and MCP. Add a fixed, opt-in `core`
MCP profile for everyday finance, retain the complete `full` compatibility
profile, and make read-only access an independent restriction. Consolidate
financial work where a single operation can enforce stronger invariants, such
as an atomic correction batch. Do not replace the catalog with a generic
`execute(action, arguments)` router.

The full profile remains the default. Structural measurements can establish a
smaller catalog and fewer bytes, but cannot establish that a particular model
selects tools more accurately. A default-profile change requires representative
live-agent evaluation across the clients Shikin supports. The initial core
selection is a candidate to evaluate, not a claim that 25 tools is optimal.

The authoritative implemented inventory is generated from actual SDK
`tools/list` responses and the shared registry. See the generated tool
inventory and benchmark artifacts alongside this document for exact current
counts, schemas, effects, and timings; do not copy a historical count into new
documentation.

## What the research establishes

| Question                                          | Evidence                                                                                                                                                                                                                                                            | Implication for Shikin                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a large catalog consume context?             | OpenAI documents that deferred discovery loads definitions only when needed; eager definitions occupy context. Individual deferred functions still expose names and descriptions, whereas deferred MCP servers initially expose their server-level description. [1] | Measure schema bytes and provider usage separately. A small catalog benefits eager hosts; host-side search can make a complete catalog efficient. |
| Can too many similar tools affect accuracy?       | Anthropic recommends distinct workflow tools, evaluating ambiguous overlap, and collecting task success, calls, tokens, runtime, and errors. [2]                                                                                                                    | Remove needless multi-call bookkeeping through domain operations, not by renaming every database method into a huge action enum.                  |
| Does tool search always improve latency?          | OpenAI describes an added discovery step and recommends representative comparisons; Anthropic likewise conditions its use on savings outweighing the additional step. [1, 3]                                                                                        | Compare short common tasks and long specialist tasks. Do not promise that every request gets faster.                                              |
| Is there empirical evidence for discovery?        | Anthropic reports an 85% token reduction in one large-library example and improved internal MCP evaluation accuracy. These are vendor-specific workloads, not Shikin results. [3]                                                                                   | This motivates an experiment; it does not justify importing those percentages into Shikin's benchmarks.                                           |
| Must the server delete specialist tools?          | MCP standardizes discovery and invocation; OpenAI supports host-side `allowed_tools` filtering and deferred MCP loading. [4, 5]                                                                                                                                     | Preserve specialized and CLI capabilities; offer an explicit profile and let compatible hosts discover the full catalog.                          |
| Is protocol batching an atomic finance operation? | SQLite transactions provide the relevant database boundary and allow only one simultaneous writer. Nested operations require savepoints rather than nested `BEGIN` statements. [6]                                                                                  | Financial batches must execute under one database transaction. Parallel independent RPCs are not an all-or-nothing financial batch.               |

None of these sources establishes a universal 15–25-tool optimum. Tool count,
schema complexity, response volume, discovery behavior, and task distribution
must be evaluated independently.

## Catalog audit and redundancy decisions

The baseline registry contained 118 built-in tools and 123 CLI commands. The
current [generated inventory](../reference/MCP-TOOL-INVENTORY.md) and its
[complete JSON contract](../reference/MCP-TOOL-INVENTORY.json) record each
tool's purpose, real input/output schema, implementation file, effects,
availability, and inclusion in core. Documentation references are a static
coverage signal; no production execution telemetry or model-selection
frequency was available. These decisions therefore combine implementation
inspection with synthetic workflow evaluation.

| User intention                                  | Related tools in the existing catalog                                                                                                                                                                      | Implemented decision and reason                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand current finances                     | `automation-context`, `get-balance-overview`, `get-budget-status`, `get-upcoming-bills`, `get-recurring-expected-vs-paid`                                                                                  | Reuse `automation-context` as the core overview: it already collects accounts, budgets, subscriptions, card obligations, recurring expectations, supporting context, and audit warnings. Retain focused reads for smaller specialist responses.                                                                               |
| Correct categories or split purchases           | `update-transaction`, `correct-transaction-metadata`, `split-transaction`                                                                                                                                  | Promote the new bounded `batch-correct-transactions` workflow. It reuses the existing metadata correction domain service for one or many explicit transactions, with atomic preview/apply and retry receipts. Financial-field updates remain separate, with their stronger evidence protections.                              |
| Create or ingest transactions                   | `add-transaction`, `import-transactions`, placeholder creation/resolution, recurring materialization                                                                                                       | Keep these distinct: ordinary creation, statement deduplication, unresolved expected activity, and scheduled activity have different identity and accounting rules. Expose ordinary creation in core and preserve advanced ingestion in full.                                                                                 |
| Choose categories and financial classifications | `list-categories`, `manage-category-rules`, `suggest-category`, `preview-consumption-classifications`, `apply-consumption-classifications`, `set-transaction-consumption`, `clear-transaction-consumption` | Core separates category metadata from consumption treatment and custom classification types. Keep preview/apply classification together; retain rule administration and individual evidence corrections in full. One generic "categorize" action would obscure distinct budget and reporting effects.                         |
| Manage current and historical budgets           | `create-budget`, `upsert-budget`, `get-budget-status`, `delete-budget`                                                                                                                                     | Prefer existing `upsert-budget` in core instead of exposing both creation entrypoints. Add `get-budget-history` and `record-budget-history` for immutable revisions, original period evidence, and explicit retrospective reconstruction. Current configuration and historical correction remain separately named operations. |
| Match internal transfers or card payments       | `match-transfer-transactions`, `unmatch-transfer-transactions`, `record-card-payment`, statement/payment-link tools, `reconcile`, staged-history finalization                                              | Keep the simpler imported transfer match in core. Statement settlement, balance reconciliation, card evidence links, staging, and reversals have distinct safeguards and remain available in full. Similar names do not make these interchangeable financial actions.                                                         |
| Track annual subscriptions and recurring plans  | `list-subscriptions`, `create-subscription`, `create-subscription-from-transaction`, `update-subscription`, `get-subscription-spending`, `manage-recurring-transaction`, `materialize-recurring`           | Core keeps subscription creation, listing, and updating. Reuse the existing annual-to-monthly planning equivalent; actual charges stay in the ledger. Preserve transaction-derived linking and recurring materialization as specialist workflows.                                                                             |
| Record client installments                      | `manage-receivable`, `list-receivables`, `match-receivable`, `unmatch-receivable`                                                                                                                          | Extend the existing match workflow with preserved payment links and partial/final receipt totals. Keep ordinary planning, inspection, and matching in core; selective reversal remains in full. No second income ledger is introduced.                                                                                        |
| Reserve funds for irregular spending            | `create-bucket`, `list-buckets`, `allocate-income`, `update-bucket`, allocation correction/reversal tools                                                                                                  | Keep inspection in core and existing reserve allocation/evidence mutations in full. These represent reserved funds, not monthly expense creation. Automatic budget rollover needs a separate tested budget-period policy.                                                                                                     |
| Analyze several periods                         | `get-spending-summary`, `analyze-spending-trends`, `get-spending-anomalies`, `get-spending-recap`, `save-spending-recap`, financial-health and forecast tools                                              | Prefer a focused spending summary in core; preserve richer specialist analyses. Retain a distinct save operation because persisting a recap is a write, unlike reading one.                                                                                                                                                   |
| Explain and recover changes                     | `audit-list`, `audit-show`, `undo`, `backup-database`, `restore-database`                                                                                                                                  | Core includes audit listing and supported undo. Individual audit detail, consistent backups, and whole-database restore remain available in full. Corrective metadata batches use new reviewed corrections and preserve their earlier audit records.                                                                          |
| Manage account and currency setup               | account create/update/upsert/delete tools, aliases, currency settings and exchange-rate tools                                                                                                              | Preserve CLI compatibility and specialized setup operations in full. Core lists relevant account identities; workflow inputs continue to use explicit account IDs and currency evidence.                                                                                                                                      |

Investments, goals, notebook operations, plugin management, source-coverage
administration, and additional specialist controls retain their existing full
interface. They were not removed to meet a count target. The core roster is
explicit and tested against the shared registry so a renamed capability or a
missing new tool fails a test instead of silently reducing access.

## Alternatives considered

| Interface                                     | Benefits                                                     | Costs and decision                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full eager catalog                            | Existing clients and complete specialist access              | Larger discovery payload; retained as the default for compatibility.                                                                             |
| Fixed core catalog                            | Lower schema overhead and a clearly defined everyday surface | Specialist work may need a restart with `full`; implemented as opt-in.                                                                           |
| Full catalog with host-side search            | Complete functionality with deferred schema loading          | Depends on the model and host; documented as a supported client strategy, not implemented by pretending to add a universal MCP search primitive. |
| Dynamic server-side enable/disable calls      | Could expose schemas after an agent requests them            | Session state, cache invalidation, client support, and permission widening are harder to reason about. Rejected for this increment.              |
| One generic router or arbitrary code/SQL tool | Very few names                                               | Hides schema complexity, weakens permission boundaries, and moves orchestration mistakes into financial writes. Rejected.                        |

Anthropic's code-execution guidance shows how a _host_ can keep intermediate
results outside model context and expose callable APIs. That does not require
Shikin to add unrestricted SQL or command execution. Shikin provides bounded
typed workflows; a capable host can compose them in its own sandbox. [7]

## Protocol and SDK compatibility

The specification website currently publishes revision `2026-07-28`. That
revision removes protocol-level sessions and the initialization handshake,
adds `server/discover`, and introduces new request/result metadata and caching
requirements. This is a substantial protocol transition, not a tool-count
optimization. [8]

The installed and locked Shikin SDK is `@modelcontextprotocol/sdk@1.29.0`; its
`LATEST_PROTOCOL_VERSION` is `2025-11-25`. This change retains that SDK's normal
negotiation and stdio behavior. It does **not** claim implementation of the
2026 stateless protocol, `server/discover`, or its mandatory cache-hint fields.
Those need a separate SDK/client compatibility change.

The latest tools specification recommends a deterministic catalog and disallows
varying it per connection or as a side effect of another request. Authorization
may affect a request's visible tools. Fixed startup profiles avoid the
session-dependent discovery pattern and give existing clients a stable
catalog. [9] Sorting registrations also makes schema and inventory comparisons
reproducible. For a future 2026 implementation, private financial resources
must receive authorization-appropriate caching; a cache hint is not an access
control. [10]

## Implemented interface

```bash
# Existing behavior and all shared tools
shikin mcp

# Everyday finance catalog
shikin mcp --profile core

# Restrict either catalog to audited reads
shikin mcp --profile full --read-only
SHIKIN_MCP_PROFILE=core SHIKIN_MCP_READ_ONLY=1 shikin mcp
```

`cli/src/mcp-profiles.ts` owns the explicit core roster and startup parser.
Unknown options, invalid profile names, and ambiguous read-only environment
values fail startup. Command-line profile selection takes precedence over the
profile environment setting; no command-line option can turn off an
environment-imposed read-only restriction.

`shikin://capabilities` reports the active profile, effective tool names and
counts, read-only policy, and restart guidance. It does not expose database
paths or change permissions. The existing account, category, and recent
transaction resources remain available. The CLI's commands and schemas remain
the complete shared catalog.

The core roster includes the existing consolidated `automation-context`,
transaction search/creation, the atomic correction workflow, classification,
budget status and history, transfer matching, spending summaries,
subscriptions, receivables, bucket inspection, audit listing, sanity checks,
and supported undo. It reuses implemented capabilities rather than adding a
second overview or separate accounting model. Specialist commands, bucket
mutations, exports, backups, restores, advanced reconciliation, and investment
operations remain in `full`.

### Schemas and responses

The server uses the SDK's `registerTool` API with each complete Zod object,
rather than discarding object-level behavior by registering only `.shape`.
MCP inputs reject unknown top-level fields, so a misspelled financial field is
not silently ignored. Existing CLI coercion and schemas are unchanged. Domain
schemas retain responsibility for nested validation and financial invariants.

Successful and domain-error responses include `structuredContent` plus the
same serialized JSON text for older clients, as recommended by the negotiated
MCP tools specification. [5] JSON is compact rather than pretty-printed. The
published output schema validates the common `success: boolean` envelope;
legacy domain-specific fields remain extensible for compatibility. This is
not a claim that every legacy domain payload has a fully closed output schema.

Domain failures preserve useful reason codes, messages, and details and use
`isError: true`. Direct handler validation failures additionally include field
issues. The SDK may reject malformed protocol/schema input before a domain
handler runs, using its own MCP error representation. Clients must inspect
`isError` or protocol errors rather than assuming that every response has a
successful financial payload. [5]

### Permission and untrusted-data boundaries

Read-only tool access is an explicit server policy, not merely an annotation
hint. Selection admits only built-in tools whose effects explicitly declare
`readOnly: true` and no write targets. Unknown effects, contradictory effects,
write tools, and all trusted-local plugin tools are excluded. Handlers enforce
the same rule if invoked directly. Guessed hidden tool names do not bypass
registration. Effect annotations alone are not a security boundary. [5]

The standalone entrypoint also configures the database read-only before a
handle opens: it requires an existing compatible database, skips storage
migration/preparation and journal-mode changes, and rejects database writes,
backup, and restore operations. SQLite/OS handling of pre-existing WAL files
can still involve sidecar activity; this is not a promise of a zero-write
filesystem sandbox. Embedded hosts using `createMcpServer` must configure
their database access separately; that factory controls the tool policy.

Stored descriptions, statements, and notes remain original financial
evidence. They are returned as data, and server instructions explicitly forbid
treating their text as instructions or authorization. A transport test includes
an instruction-like transaction description to verify it remains a plain
field. This is defense in depth, not a claim that a text instruction alone
solves prompt injection. Host approval and data-exfiltration protections remain
relevant, especially with other connected services. [4]

Existing plugin discovery reads local manifests and enablement state; it does
not import plugin JavaScript. Code import happens only on plugin execution.
Read-only mode excludes plugin execution even if a future manifest were to
claim read-only effects.

## Atomic operations, retries, and recovery

New batch writes should validate the complete request, resolve an explicit
preview, and write financial changes, audit entries, and an idempotency receipt
in one transaction. A failure must roll back the whole operation. A preview
must not create a receipt, audit revision, reserve expense, or ledger row.
Changing reviewed data invalidates the preview rather than broadening the
selected transaction set.

An idempotency key identifies an operation, not a transaction description.
Bind it to canonical semantic arguments and return the original result for a
completed identical retry. Reject reuse with different arguments. Stripe's
API documentation provides an established example of retry keys and
parameter-mismatch rejection; Shikin's retention and transactional semantics
are its own local design. [11] Do not confuse JSON-RPC request IDs or an
`idempotentHint` with a durable retry guarantee.

The existing `undo` tool supports transaction and credit-card-statement
`create`/`update`/`delete` audit entries. It does not reverse metadata-correction
entries or the new batch receipt. To reverse a metadata correction, inspect
the preserved per-transaction before evidence with `audit-list`, construct a
new explicit correction, and preview it against the current database before
applying with a new idempotency key. This preserves intervening work and a
complete correction history. Reusing the original key returns the original
receipt; it never means "reverse this operation."

Use existing backup/restore safeguards and SQLite-consistent snapshots,
rather than copying a live database file while writers run. SQLite documents
its backup API as a snapshot mechanism designed for a live source database.
[12] A financial correction or supported undo is usually more precise than
restoring an entire old database, which also removes unrelated later work.

## Evaluation and release criteria

Run against newly created synthetic databases and record the baseline commit,
software versions, fixture size, machine/runtime, and exact command. Never
point benchmark or destructive test commands at user financial data.

Keep these measurements distinct:

1. **Structural:** actual `tools/list` tool count, UTF-8 JSON bytes, schema
   bytes, and token estimates only when a named tokenizer is used. A
   bytes-per-token approximation must be labeled a heuristic, not API billing.
2. **Deterministic workflows:** financial postconditions, tool calls, response
   bytes, measured execution time, rollback behavior, audit history, and
   same-key retry behavior. Scripted workflow success is not model accuracy.
3. **Live model evaluations:** same prompts and synthetic starting states,
   fixed model versions and host settings, repeated runs, reported token usage,
   task completion, tool-selection errors, calls, discovery overhead, and
   end-to-end latency. Include eager full, eager core, and deferred full when
   the host supports it. Report cached and uncached runs separately.

Use the ten requested scenarios: classify ten purchases, split a purchase,
link a partial refund, revise a historical budget, analyze multiple months,
match transfers, plan an annual subscription, record partial client payments,
detect duplicates, and recover from failed/repeated operations. Assert the
financial outcome rather than enforcing a single exact valid call sequence.
Add typo, stale preview, key reuse, mid-batch failure, read-only, and untrusted
description cases. Keep held-out scenarios when tuning tool descriptions, as
recommended by Anthropic's evaluation guidance. [2]

The [completed benchmark and validation report](../benchmarks/MCP-BENCHMARKS.md)
links both raw catalogs, all seven samples per scenario/profile, and exact
local tokenizer counts. The core catalog contains 25 tools and 42,668 UTF-8
bytes versus the baseline's 118 tools and 132,658 bytes. Its locally encoded
`o200k_base` count is 10,156 versus 31,106. The full default grows to 121 tools
and 162,122 bytes; it is retained for compatibility, not described as smaller.

All ten candidate financial scenarios passed in every repetition; the baseline
supported seven and lacked the exact requirements for three. Categorizing ten
purchases requires two reviewed calls rather than twenty, with lower result
volume and stronger atomicity, but measured local elapsed time is 20.25 ms
versus 19.40 ms. This supports bounded workflow consolidation and an opt-in
small catalog while preserving the full default. No live-model token, accuracy,
billing, or end-to-end latency improvement is claimed without that evaluation.

## Prioritized follow-up

1. Run provider/host-specific live-agent evaluations before changing the
   default from `full` or claiming a task-success improvement.
2. Audit the remaining unknown tool effects and add narrowly closed domain
   output schemas, with negative tests for incorrect annotations.
3. Expand atomic workflows only when realistic traces reveal repeated calls
   or unreliable multi-step operations; preserve preview and retry semantics.
4. Evaluate the 2026 protocol SDK transition independently, including client
   negotiation, discovery, private caching, and explicit state handles.
5. Consider additional fixed profiles or a host-side tool-search adapter only
   if measured workloads justify their maintenance and discovery overhead.

## Sources

1. [OpenAI: Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)
2. [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
3. [Anthropic: Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
4. [OpenAI: MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
5. [MCP tools, negotiated 2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
6. [SQLite: Transactions](https://sqlite.org/lang_transaction.html)
7. [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
8. [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
9. [MCP tools, current 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
10. [MCP 2026-07-28 caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
11. [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
12. [SQLite: Online Backup API](https://sqlite.org/backup.html)
