# MCP benchmarks and validation

Measured on 2026-10-17 against the pinned v1.2.1 baseline
`880a70cec933dd8fa9799233b1cbc3bb1a47be20` and the candidate changes in this PR.
The same reviewed harness ran sequentially against independently installed and
built checkouts. Every task sample used a new synthetic SQLite database.

## Findings and decision

The opt-in **core profile has 25 tools**, compared with the baseline's 118.
Its compact discovery JSON is **67.8% smaller**, and its locally encoded
`o200k_base` token count is **67.4% lower**. This supports offering a smaller
catalog to hosts that load every definition. It does not establish an optimal
tool count or better model selection accuracy. The **full profile remains the
compatibility default**, preserving all original tools and CLI commands.

The full candidate has 121 tools and 126 CLI commands, including three new
workflows. Its catalog is **22.2% larger in bytes** than the baseline because
it adds capabilities, output contracts, and stricter inputs. Full-profile
discovery was also slower in this local run. No claim is made that the default
catalog became smaller or faster.

The ten-purchase category correction uses **2 calls instead of 20**, with a
single atomic apply, a bound preview, and a durable retry receipt. Its response
text shrank by **86.5%** and serialized result payload by **74.7%**. Its local
elapsed time was **20.25 ms versus 19.40 ms**; fewer model/host round trips did
not make the local database workload faster. Model inference, host round trips,
and user approval latency were not measured.

All ten candidate scenarios passed in each of seven repetitions. The baseline
passed seven scenarios and lacked the exact capabilities required for three.
These are deterministic financial-contract checks, **not live-agent task
success or tool-selection accuracy measurements**.

## Discovery size and local tokenizer counts

Bytes are the UTF-8 size of the exact compact `JSON.stringify(tools/list)`
result, including names, descriptions, input schemas, output schemas, and
annotations when present. They exclude server instructions, resources, client
formatting, JSON-RPC framing, and model messages. Plugins are excluded from
these reproducible built-in counts.

| Version/profile           | Tools | Catalog bytes | `o200k_base` tokens | `cl100k_base` tokens |
| ------------------------- | ----: | ------------: | ------------------: | -------------------: |
| Baseline full             |   118 |       132,658 |              31,106 |               29,887 |
| Candidate full, default   |   121 |       162,122 |              37,964 |               36,439 |
| Candidate core, opt-in    |    25 |        42,668 |              10,156 |                9,778 |
| Candidate full, read-only |    24 |        25,228 |               6,129 |                5,920 |
| Candidate core, read-only |    14 |        16,957 |               4,169 |                4,031 |

Token counts use pinned `tiktoken==0.12.0` with the two named encodings, locally.
The helper reproduces Node's exact JSON serialization, checks byte counts, and
saves each catalog's SHA-256. These are measured encoding counts, not
bytes-per-token estimates. They are **not provider usage, billing, cached-token
counts, or the tokenizer contract of an unspecified current model**.

## Server construction and discovery timing

Median milliseconds over seven repetitions, after module imports:

| Version/profile           | Construction/registration | Protocol handshake | `tools/list` |
| ------------------------- | ------------------------: | -----------------: | -----------: |
| Baseline full             |                     2.044 |              0.643 |        9.254 |
| Candidate full            |                     1.327 |              0.803 |       25.178 |
| Candidate core            |                     0.438 |              0.388 |        3.321 |
| Candidate full, read-only |                     0.332 |              0.280 |        2.524 |
| Candidate core, read-only |                     0.244 |              0.258 |        1.591 |

The SDK's in-memory transport performs real protocol validation and invocation,
but does not include stdio/HTTP/network transport. Construction, handshake, and
listing are timed separately. This excludes total process startup, module and
schema definition evaluation, native-binding load, and the first financial
query. Profiles run in a fixed order; JIT/cache behavior and ordinary shared
runner noise can affect timings. The seven raw samples are retained for each
profile. Do not turn these small local measurements into a general cold-start
or end-to-end latency claim.

## Financial workflow comparison

Both versions use their **full** MCP catalog for these tasks. Core discovery is
measured separately; this table does not claim that advanced import/recovery
workflows are all exposed in core. Inputs start with known synthetic fixture
IDs. Calls needed to find those IDs, model deliberation, and approval prompts
are outside this scripted comparison.

Elapsed times below are medians in milliseconds, excluding database creation
and fixture seeding but including the scenario's assertions and direct evidence
reads. The raw files also record time spent awaiting tool calls separately.

| #   | Scenario                                                  | Baseline outcome / calls  | Candidate outcome / calls | Baseline elapsed ms | Candidate elapsed ms |
| --- | --------------------------------------------------------- | ------------------------- | ------------------------- | ------------------: | -------------------: |
| 1   | Categorize ten Amazon purchases                           | Pass / 20                 | Pass / 2                  |               19.40 |                20.25 |
| 2   | Split a household purchase                                | Pass / 2                  | Pass / 2                  |                7.97 |                10.49 |
| 3   | Link a partial refund                                     | Pass / 2                  | Pass / 2                  |                8.49 |                10.46 |
| 4   | Correct history without losing the original               | Unsupported / 0           | Pass / 6                  |                   — |                19.03 |
| 5   | Analyze three months of spending                          | Pass / 1                  | Pass / 1                  |                6.91 |                 7.97 |
| 6   | Reconcile internal transfers                              | Pass / 2                  | Pass / 2                  |               10.54 |                13.02 |
| 7   | Track an annual subscription                              | Pass / 2                  | Pass / 2                  |                7.26 |                 9.06 |
| 8   | Record partial client payments                            | Unsupported / 2 attempted | Pass / 5                  |                   — |                12.02 |
| 9   | Detect and retry a duplicate import                       | Pass / 4                  | Pass / 4                  |               14.85 |                18.01 |
| 10  | Recover an atomic batch after failure and repeat delivery | Unsupported / 0           | Pass / 4                  |                   — |                14.22 |

The asserted financial outcomes are:

1. All ten purchases have the intended category and subcategory; source evidence
   and account balances are unchanged. Both versions preview every proposed
   change before applying. The baseline requires ten previews and ten writes;
   the candidate uses one preview and one atomic write.
2. The two split rows are exactly 6,000 and 4,000 centavos in the intended
   categories, summing to the original 10,000-centavo bank amount.
3. The refund classification points to the intended purchase classification,
   with the correct parent/split identity and unchanged bank evidence.
4. An initial 100,000-centavo budget capture and a corrected 120,000-centavo
   revision survive a separate live-budget change to 200,000. The first stored
   row is unchanged, actual gross spending is 20,000, and remaining amounts are
   80,000 and 100,000. The first capture is explicitly retrospective.
5. Monthly groups contain exactly July 7,000, August 8,000, and September 20,000
   centavos, totaling 35,000.
6. The matched pair becomes one transfer and its archived mirror evidence;
   account balances remain unchanged.
7. A 1,200-per-year subscription has a 100-per-month planning equivalent and
   creates no bank transaction.
8. A 2,000 receivable moves through partial receipt of 500 to full receipt with
   the second 1,500 payment, using existing bank transactions unchanged.
9. The repeated import explicitly identifies the row as idempotent. Applying
   it again retains exactly one source-identified transaction and leaves bank
   evidence and balances unchanged.
10. An injected second-row audit failure rolls back the entire batch. Retrying
    applies both corrections with two metadata audits and one batch receipt;
    repeating the same key returns that receipt with no further changes.

The baseline partial-payment preview returns its expected
`payment_amount_mismatch` error once per repetition. Each candidate recovery
sample deliberately contains one injected error before its successful retry.
These expected errors are counted in the raw metrics. There were no unexpected
failed scenarios. Baseline unsupported behavior is not mislabeled a model
failure, and unsupported timings are not compared to successful work.

### Response sizes

The ten-purchase workflow returns 36,540 → 4,920 bytes of text and
42,030 → 10,654 bytes of serialized result payload. The raw key
`responseWireBytes` means `JSON.stringify(CallToolResult)` bytes; it **excludes
JSON-RPC envelopes and transport framing**.

The candidate supplies both `structuredContent` and compact JSON text for
compatibility. That duplicates result data in the payload, so unchanged
single-purpose workflows often have larger total payloads despite shorter text.
For example, the three-month report goes from 20,618 to 13,955 text bytes but
from 23,053 to 29,576 serialized result bytes. Host/model handling of those two
representations was not measured.

## Environment and provenance

- Linux x64, kernel 6.18.55; Node 24.19.0.
- Runner reported AMD EPYC 9V74 80-Core Processor and nine logical CPUs exposed
  to the container. This is a shared execution environment, not dedicated
  performance hardware.
- Locked MCP SDK 1.29.0, negotiated protocol 2025-11-25, better-sqlite3 12.8.0.
- Baseline and candidate dependencies were installed independently; their
  finance-core exports resolve within their respective checkouts. Each was
  built before measurement. No symlink to the candidate's core was used by the
  baseline.
- Every task sample initializes two accounts and 18 posted bank transactions:
  ten purchases, three monthly expenses, one refund, a transfer pair, and two
  client installments. No installed plugin or user financial
  database is read. Temporary roots and extension directories are isolated.
- Seven repetitions per profile and per scenario; baseline and candidate run
  sequentially after tests and browser processes finish. Every raw sample is
  retained, and any failed repetition fails its scenario.

The raw artifacts record the baseline parent SHA, separate SHA-256 digests for
the measured source tree and actual built finance-core JavaScript, the resolved
package entry point, source/build file counts, and the identical harness hash.
The candidate was measured before committing, so its `source.revision` records
the baseline parent rather than pretending the uncommitted changes were already
a published commit. Its source/build digests and complete catalogs identify the
measured implementation; the PR contains that implementation and harness.

## Repository validation

| Gate                               | Result                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                       | Passed: ESLint, root/CLI/core TypeScript checks, and repository formatting.                                                                                                         |
| `pnpm test:run`                    | **219 files / 2,459 tests passed**, no failures; 332.89 seconds.                                                                                                                    |
| `pnpm build`                       | Passed production TypeScript/Vite build.                                                                                                                                            |
| `pnpm build:cli` script            | Passed packaged CLI/MCP build and deployment smoke with pnpm 11.1.1; 121-tool parity and import, correction, coverage, payment-link, runtime-read, recap, and hosted-web workflows. |
| Existing Playwright suite          | **119 passed / 27 skipped / 0 failed**, 146 scheduled; 5.7 minutes.                                                                                                                 |
| Generated inventory                | Passed regeneration and drift check: 121 tools, 126 CLI commands, 25 core tools.                                                                                                    |
| `pnpm release:preflight`           | Passed version/updater/plugin version checks.                                                                                                                                       |
| Benchmark financial contracts      | Candidate **70/70 scenario samples passed**; baseline 49 passed and 21 unsupported, no unexpected failures.                                                                         |
| Tokenizer/benchmark helpers        | Executed successfully; JSON byte consistency and JavaScript syntax checked.                                                                                                         |
| `git diff --check`                 | Passed.                                                                                                                                                                             |
| Native Rust/Tauri tests and bundle | **Not run**: this runner has no Cargo/Rust toolchain (`cargo` exited 127). Native release validation remains required.                                                              |

The baseline full suite had 2,343 passing tests and one pre-existing
permission-test failure: a privileged runner could append to a POSIX
read-only-mode file. The candidate makes that test portable by injecting EACCES
at the intended append boundary while still checking the real migrated file
bytes. It does not remove the migration/preservation assertions.

The final migration hardening changed the two new immutable tables to
`WITHOUT ROWID`. Existing all-table rollback snapshot helpers were updated to
order those tables by their explicit primary key; all existing table contents
and rollback comparisons remain asserted. The final complete suite passed after
those fixture adjustments. No browser tests or configurations were modified to
obtain the E2E result.

Playwright 1.58.2 used the matching Chrome Headless Shell 145.0.7632.6 with
`SHIKIN_BROWSER_USE_REAL_DATA=0`. Twenty-one skips are existing viewport-specific
exclusions; six are existing fixture-conditional classification/identity checks
when the relevant staged QA row is absent. These skips are not passing tests.
The Playwright CDN returned a non-ZIP error page in this environment, so the
matching official Chrome-for-Testing archive was fetched and checksum-verified;
the browser passed a render probe before the unchanged suite ran.

The runner's nested global pnpm resolved 11.25.0 despite the repository's 11.1.1
pin. The packaged smoke script correctly rejected that mismatch. It was then run
unchanged with `npm_execpath` pointing to the installed pinned 11.1.1 entrypoint:

```bash
env npm_execpath=/root/.cache/node/corepack/v1/pnpm/11.1.1/bin/pnpm.cjs \
  node scripts/smoke-cli-deployment.mjs
```

That path is specific to this runner. In a normal checkout with the pinned pnpm
on PATH, use `pnpm build:cli`.

## Reproduce

Use a Linux/XDG runner for the isolated benchmark harness. Install and build
both checkouts independently with the repository's pinned pnpm version. Run
the **candidate harness** against both versions; do not change harness versions
between the comparison runs. Choose a new baseline checkout path if it already
exists, and run from the candidate checkout:

```bash
git worktree add --detach /tmp/shikin-baseline-880a70c \
  880a70cec933dd8fa9799233b1cbc3bb1a47be20
pnpm --dir /tmp/shikin-baseline-880a70c install --frozen-lockfile
pnpm --dir /tmp/shikin-baseline-880a70c build:finance-core
pnpm install --frozen-lockfile
pnpm build:finance-core

node --import tsx scripts/benchmark-mcp.mjs \
  --repo /tmp/shikin-baseline-880a70c --iterations 7 \
  --output docs/benchmarks/baseline-880a70c.json
node --import tsx scripts/benchmark-mcp.mjs \
  --repo "$PWD" --iterations 7 \
  --output docs/benchmarks/candidate-agent-workflows.json

python -m venv /tmp/shikin-benchmark-tokenizer
/tmp/shikin-benchmark-tokenizer/bin/pip install tiktoken==0.12.0
/tmp/shikin-benchmark-tokenizer/bin/python scripts/measure-mcp-schema-tokens.py \
  docs/benchmarks/baseline-880a70c.json \
  docs/benchmarks/candidate-agent-workflows.json \
  --output docs/benchmarks/schema-tokens.json

pnpm check
pnpm test:run
pnpm build
pnpm build:cli
pnpm inventory:check
pnpm exec playwright install chromium
SHIKIN_BROWSER_USE_REAL_DATA=0 pnpm exec playwright test --reporter=line
```

Each benchmark invocation overrides the data root, legacy-migration policy, and
extension directory before importing Shikin. The script creates and removes its
own temporary database family. Never substitute a real user database path.

## Artifacts and next evaluation

- [Baseline raw results and actual catalog](baseline-880a70c.json)
- [Candidate raw results and four actual catalogs](candidate-agent-workflows.json)
- [Exact local schema token counts and catalog hashes](schema-tokens.json)
- [Benchmark harness](../../scripts/benchmark-mcp.mjs)
- [Tokenizer helper](../../scripts/measure-mcp-schema-tokens.py)
- [Generated tool inventory](../reference/MCP-TOOL-INVENTORY.md)
- [Architecture alternatives and authoritative research](../research/MCP-DESIGN.md)
- [Financial capability research](../research/FINANCIAL-CAPABILITIES.md)
- [Migration and compatibility guide](../guides/AGENT-WORKFLOWS-UPGRADE.md)

A future live-agent evaluation should compare eager full, eager core, and
host-deferred full using fixed model versions, the same synthetic starting
states, representative prompts, and repeated held-out tasks. Measure provider
token usage, discovery calls, selection errors, user-visible task completion,
and end-to-end latency, separating cached and uncached runs. Those measurements
are required before changing the default profile or claiming a model accuracy
or cost improvement.
