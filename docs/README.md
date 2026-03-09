# Valute Documentation

## Guides

| Document | Description |
|----------|-------------|
| [Architecture](guides/ARCHITECTURE.md) | System design, component hierarchy, data flow, IPC, security model |
| [Contributing](guides/CONTRIBUTING.md) | Dev setup, code conventions, testing, PR process |

## Planning

| Document | Description |
|----------|-------------|
| [Roadmap](planning/ROADMAP.md) | 10 epics with tasks, dependencies, and release milestones |

## Reference

| Document | Description |
|----------|-------------|
| [Database](reference/DATABASE.md) | SQLite schema (14 tables), conventions, migrations, example queries |
| [AI Tools](reference/AI-TOOLS.md) | Val assistant architecture, 24 tool definitions, system prompt |
| [API](reference/API.md) | Local HTTP API specification (planned) |
| [Extensions](reference/EXTENSIONS.md) | Plugin system design, manifest format, permissions, hooks |
| [Research](reference/valute-research.md) | Design research and notes |

## Development (local only, gitignored)

Sprint tracking and backlog live in `docs/development/`. These files are gitignored and only exist locally for development coordination.

```
docs/development/
├── backlog.md              # All work items not yet in a sprint
├── epics.md                # Epic-level tracking across sprints
└── sprints/
    └── sprint-N/
        ├── overview.md     # Sprint goals, dates, status
        ├── prompts/        # Ready-to-run delegation prompts
        └── results/        # Output from completed work
```
