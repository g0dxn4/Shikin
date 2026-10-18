# Shikin Documentation

Product overview, install, and privacy: the root [README](../README.md).

## Current vs historical docs

- **Current implementation docs**: Start with `reference/BACKEND-MAP.md`, `reference/FRONTEND-MAP.md`, `guides/CONTRIBUTING.md`, and current runtime/reference docs.
- **User-facing automation**: `reference/AUTOMATION-WORKFLOWS.md` and [cli/README.md](../cli/README.md).
- **Historical plans and QA ledgers**: dated phase and commit records under `planning/` preserve earlier decisions and results; they do not certify the latest branch. The roadmap and ideas backlog identify current gaps.

## Guides

| Document                               | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| [Architecture](guides/ARCHITECTURE.md) | Current runtimes, shared rules, and financial invariants |
| [Contributing](guides/CONTRIBUTING.md) | Dev setup, code conventions, testing, PR process         |

## Planning

| Document                       | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| [Roadmap](planning/ROADMAP.md) | Product epics, delivered scope, and near-term priorities |
| [Ideas](planning/IDEAS.md)     | Feature ideas backlog with priority tiers                |

## Reference

| Document                                                  | Description                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Database](reference/DATABASE.md)                         | SQLite schema, conventions, migrations, example queries                 |
| [Backend Map](reference/BACKEND-MAP.md)                   | Current CLI, MCP, local bridge, and backend entry-point map             |
| [Automation Workflows](reference/AUTOMATION-WORKFLOWS.md) | Generic CLI/MCP finance workflows, provenance rules, and smoke coverage |
| [Frontend Map](reference/FRONTEND-MAP.md)                 | Current routes, stores, dialogs, and frontend entry-point map           |
| [API](reference/API.md)                                   | Local HTTP API specification (planned)                                  |
| [Extensions](reference/EXTENSIONS.md)                     | Plugin system design, manifest format, permissions, hooks               |
| [Changelog](../CHANGELOG.md)                              | Recent shipped changes and release notes                                |

## Quick stats

| Metric            | Count                                                  |
| ----------------- | ------------------------------------------------------ |
| Visible pages     | 18 (plus `/insights` redirect)                         |
| Zustand stores    | 18                                                     |
| CLI/MCP tools     | [Generated inventory](reference/MCP-TOOL-INVENTORY.md) |
| i18n namespaces   | 19                                                     |
| Languages         | 2                                                      |
| Navigation groups | 6                                                      |

`shikin tools --json` is the complete CLI catalog; MCP `tools/list` reflects its
fixed launch profile. `pnpm inventory:generate` creates the reference and
`pnpm inventory:check` prevents drift. Counts in historical release/planning
records are not current discovery data.

## Agent workflows and financial modernization

| Document                                                              | Description                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [MCP architecture and research](research/MCP-DESIGN.md)               | Primary sources, alternatives, redundancy analysis, permissions, and compatibility.  |
| [Financial capability comparison](research/FINANCIAL-CAPABILITIES.md) | Competitor research, existing features, implemented gaps, and prioritized follow-up. |
| [Budget history](BUDGET_HISTORY.md)                                   | Saved monthly evidence and auditable corrections in app, CLI, and MCP.               |
| [Receivable payments](RECEIVABLE_PAYMENTS.md)                         | Expected income, actual installments, source guards, and selective reversal.         |
| [Upgrade guide](guides/AGENT-WORKFLOWS-UPGRADE.md)                    | Schema 25/26, backups, read-only startup, and old-client compatibility.              |
| [MCP inventory](reference/MCP-TOOL-INVENTORY.md)                      | Generated tool purposes, schemas, implementations, and safety effects.               |
| [Benchmark and validation](benchmarks/MCP-BENCHMARKS.md)              | Reproducible baseline/candidate metrics and exact test evidence.                     |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.
