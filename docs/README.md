# Shikin Documentation

## Current vs Historical Docs

- **Current implementation docs**: Start with `reference/BACKEND-MAP.md`, `reference/FRONTEND-MAP.md`, `guides/CONTRIBUTING.md`, and current runtime/reference docs.

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

| Document                                  | Description                                                   |
| ----------------------------------------- | ------------------------------------------------------------- |
| [Database](reference/DATABASE.md)         | SQLite schema, conventions, migrations, example queries       |
| [Backend Map](reference/BACKEND-MAP.md)   | Current CLI, MCP, local bridge, and backend entry-point map   |
| [Frontend Map](reference/FRONTEND-MAP.md) | Current routes, stores, dialogs, and frontend entry-point map |
| [API](reference/API.md)                   | Local HTTP API specification (planned)                        |
| [Extensions](reference/EXTENSIONS.md)     | Plugin system design, manifest format, permissions, hooks     |
| [Changelog](../CHANGELOG.md)              | Recent shipped changes and release notes                      |

## Quick Stats

| Metric            | Count |
| ----------------- | ----- |
| Pages (routed)    | 13    |
| Pages (total)     | 16    |
| Zustand Stores    | 19    |
| CLI/MCP Tools     | 41    |
| Service Files     | 24    |
| Database Tables   | 19    |
| i18n Namespaces   | 15    |
| Languages         | 2     |
| Sidebar Nav Items | 10    |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.
