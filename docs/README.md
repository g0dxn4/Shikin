# Valute Documentation

## Current vs Historical Docs

- **Current implementation docs**: Use Guides + Planning + Reference docs first. These reflect the browser-first runtime (`sql.js` + IndexedDB + localStorage).
- **Historical docs**: `reference/valute-research.md` is archival context from early planning and may not match current implementation details.

## Guides

| Document                               | Description                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| [Architecture](guides/ARCHITECTURE.md) | Browser runtime architecture, component hierarchy, data flow, security model |
| [Contributing](guides/CONTRIBUTING.md) | Dev setup, code conventions, testing, PR process                             |

## Planning

| Document                       | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| [Roadmap](planning/ROADMAP.md) | Product epics, delivered scope, and near-term priorities |

## Reference

| Document                                 | Description                                                           |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [Database](reference/DATABASE.md)        | Browser-local SQLite schema, conventions, migrations, example queries |
| [AI Tools](reference/AI-TOOLS.md)        | Val assistant architecture, tool definitions, system prompt           |
| [API](reference/API.md)                  | Local HTTP API specification (planned)                                |
| [Extensions](reference/EXTENSIONS.md)    | Plugin system design, manifest format, permissions, hooks             |
| [Research](reference/valute-research.md) | Historical design research and early strategy notes                   |
| [Changelog](../CHANGELOG.md)             | Recent shipped changes and release notes                              |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.

```
docs/development/
├── backlog.md              # All work items not yet in a sprint
├── epics.md                # Epic-level tracking across sprints
└── sprints/
    ├── archive/            # Completed historical sprints
    └── sprint-N/
        ├── overview.md     # Sprint goals, dates, status
        ├── prompts/        # Ready-to-run delegation prompts
        └── results/        # Output from completed work
```
