# Product improvement backlog

Reviewed on 2026-10-17. The old wishlist included goals, recurring rules,
forecasts, debt planning and splits that already exist. Use the
[roadmap](ROADMAP.md) and [generated tool inventory](../reference/MCP-TOOL-INVENTORY.md)
for current capabilities. This backlog describes extensions to those systems.
The [financial application comparison](../research/FINANCIAL-CAPABILITIES.md)
records the primary research and design tradeoffs.

## Near-term financial improvements

| Idea                                | Existing foundation                                                          | Completion criteria                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Full subcategory workflows          | Subcategory storage and transaction metadata exist                           | Create/edit/archive controls, parent validation, exact scope matching, CLI/MCP parity and historical label evidence                  |
| Independent budget assignment rules | Budget scopes already support category/account/tag inclusions and exclusions | Versioned rule priority, explicit per-transaction overrides, previewed conflict resolution and atomic bulk reclassification          |
| Rollover and sinking-fund policy    | Virtual buckets and reversible allocations already exist                     | Optional monthly carryover, explicit negative-balance policy, auditable starting adjustments and no fictional expenses               |
| One payment across invoices         | Multiple payments per receivable are now supported                           | Allocation ownership and caps across invoices, safe partial reversal and unchanged original bank amounts                             |
| Legacy receipt corrections          | Migration preserves received money without inventing evidence                | Reasoned additive adjustments with original baseline retained; separate attribution of verified bank evidence                        |
| Budget-history comparison UI        | Frozen monthly captures and revisions are now supported                      | Compare periods with visible currency/scope changes, incomplete evidence and retrospective labels; never infer absent original plans |

## Agent experience and reliability

| Idea                                | Existing foundation                                                                  | Completion criteria                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Evaluate smaller primary interfaces | Opt-in core profile and reproducible synthetic benchmark                             | Fixed-model, repeated held-out tasks with actual token and latency measurements, including tasks requiring advanced tools |
| Optional host-side discovery        | Full stable catalog and capability resource                                          | Prove client support, measure discovery overhead and retain permission boundaries; no unrestricted dispatcher             |
| Narrow response contracts           | Compact JSON and structured MCP responses                                            | Domain-specific output schemas with compatible versioning and real error examples                                         |
| More atomic workflows               | Classification batches and metadata batch corrections                                | Add only workflows evidenced by repeated operations; preview, stale-state rejection, durable retries and rollback tests   |
| Better read-only coverage           | Audited read-only profiles and a physically read-only standalone database connection | Review unannotated readers individually, including lazy writes and external effects, before admitting them                |

## Longer-term research

- Recurring-pattern suggestions with explicit user approval and persisted source
  evidence; a suggestion must not create a bank transaction automatically.
- Forecast ranges that distinguish uncertain future income from money received,
  and disclose their assumptions instead of presenting a precise prediction.
- Additional verified quote providers and better stale/incomplete valuation UX,
  reusing instrument identity and manual valuation paths.
- Trusted plugin improvements and, separately, an actual sandboxed community
  extension design. The current trusted-local plugin MVP is not a sandbox.

Prioritize correctness and useful financial workflows over additional dashboards
or duplicate data models. Each increment needs isolated financial postconditions,
frontend/CLI/MCP parity where applicable, and documentation of its limits.
