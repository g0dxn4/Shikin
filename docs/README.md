# Valute Documentation

## Current vs Historical Docs

- **Current implementation docs**: Use Guides + Planning + Reference docs first. These reflect the browser-first runtime (`sql.js` + IndexedDB + localStorage).
- **Historical docs**: `reference/valute-research.md` is archival context from early planning and may not match current implementation details.

## Guides

| Document                               | Description                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| [Architecture](guides/ARCHITECTURE.md) | Browser runtime architecture, 5 layers, 19 stores, 27 services, AI tool flow       |
| [Contributing](guides/CONTRIBUTING.md) | Dev setup, code conventions, testing, PR process                                    |

## Planning

| Document                       | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| [Roadmap](planning/ROADMAP.md) | Product epics, delivered scope, and near-term priorities |
| [Ideas](planning/IDEAS.md)     | Feature ideas backlog with priority tiers                |

## Reference

| Document                                 | Description                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| [Database](reference/DATABASE.md)        | 21-table SQLite schema, conventions, 10 migrations, example queries    |
| [AI Tools](reference/AI-TOOLS.md)        | 43 tools across 14 categories, system prompt, provider support         |
| [API](reference/API.md)                  | Local HTTP API specification (planned)                                 |
| [Extensions](reference/EXTENSIONS.md)    | Plugin system design, manifest format, permissions, hooks              |
| [Research](reference/valute-research.md) | Historical design research and early strategy notes                    |
| [Changelog](../CHANGELOG.md)            | Recent shipped changes and release notes                               |

## Quick Stats

| Metric            | Count |
| ----------------- | ----- |
| Pages (routed)    | 12    |
| Pages (total)     | 18    |
| Zustand Stores    | 19    |
| AI Tools          | 43    |
| Service Files     | 27    |
| Database Tables   | 21    |
| i18n Namespaces   | 13    |
| Languages         | 2     |
| AI Providers      | 9     |
| Sidebar Nav Items | 12    |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.
