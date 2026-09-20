# Shikin Documentation

Product overview, install, and privacy: the root [README](../README.md).

## Current vs historical docs

- **Current implementation docs**: Start with `reference/BACKEND-MAP.md`, `reference/FRONTEND-MAP.md`, `guides/CONTRIBUTING.md`, and current runtime/reference docs.
- **User-facing automation**: `reference/AUTOMATION-WORKFLOWS.md` and [cli/README.md](../cli/README.md).

## Guides

| Document                               | Description                                      |
| -------------------------------------- | ------------------------------------------------ |
| [Architecture](guides/ARCHITECTURE.md) | Historical browser-first architecture notes      |
| [Contributing](guides/CONTRIBUTING.md) | Dev setup, code conventions, testing, PR process |

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

| Metric            | Count                         |
| ----------------- | ----------------------------- |
| Pages (routed)    | 19                            |
| Zustand stores    | 18                            |
| CLI/MCP tools     | 108 shared / 113 CLI commands |
| i18n namespaces   | 19                            |
| Languages         | 2                             |
| Navigation groups | 6                             |

`shikin tools --json` is the live catalog. Do not treat historical 91/96 counts in planning docs as current.

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.
