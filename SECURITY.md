# Security Policy

## Reporting a vulnerability

Report security issues **privately** with GitHub’s vulnerability reporting:

**https://github.com/g0dxn4/Shikin/security/advisories/new**

Do not open a public issue, discussion, or pull request for a vulnerability.

Do **not** attach databases, `.env` files, backups, secrets, credentials, or unredacted exports. Describe the issue with a redacted or synthetic reproduction, the app version or commit, OS/platform, and whether you used desktop, hosted web, or CLI/MCP.

This form is only for security vulnerabilities. Conduct or abuse reports belong on GitHub’s [report abuse](https://github.com/contact/report-abuse) flow — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Product help is in [SUPPORT.md](SUPPORT.md).

## Supported versions

Please report against the latest published GitHub Release and the `main` branch. Older tagged builds may already be fixed on `main`.

## Scope notes

Shikin is local-first software. Optional FX and price refresh contact third-party APIs. Optional CLI/MCP clients and external AI tools are outside this project’s control. Hosted web is loopback-only by design; exposing it beyond loopback (including public tunnels) is out of scope as a supported deployment.
