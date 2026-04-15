# Shikin Documentation

## Current vs Historical Docs

- **Current implementation docs**: Start with `reference/BACKEND-MAP.md`, `reference/FRONTEND-MAP.md`, `guides/CONTRIBUTING.md`, and current runtime/reference docs.
- **Historical docs**: `reference/AI-TOOLS.md` and `reference/shikin-research.md` are archival context from earlier AI-first planning and may not match current implementation details.

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

| Document                                  | Description                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- |
| [Database](reference/DATABASE.md)         | 21-table SQLite schema, conventions, 10 migrations, example queries |
| [Backend Map](reference/BACKEND-MAP.md)   | Current CLI, MCP, local bridge, and backend entry-point map         |
| [Frontend Map](reference/FRONTEND-MAP.md) | Current routes, stores, dialogs, and frontend entry-point map       |
| [AI Tools](reference/AI-TOOLS.md)         | Historical frontend AI-agent planning document                      |
| [API](reference/API.md)                   | Local HTTP API specification (planned)                              |
| [Extensions](reference/EXTENSIONS.md)     | Plugin system design, manifest format, permissions, hooks           |
| [Research](reference/shikin-research.md)  | Historical design research and early strategy notes                 |
| [Changelog](../CHANGELOG.md)              | Recent shipped changes and release notes                            |

## Quick Stats

| Metric            | Count |
| ----------------- | ----- |
| Pages (routed)    | 14    |
| Pages (total)     | 19    |
| Zustand Stores    | 19    |
| CLI/MCP Tools     | 44    |
| Service Files     | 27    |
| Database Tables   | 21    |
| i18n Namespaces   | 13    |
| Languages         | 2     |
| AI Providers      | 9     |
| Sidebar Nav Items | 12    |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.
