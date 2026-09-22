# Dated FX financial foundation (phase A)

## Authority and scope

Schema **022_dated_fx** adds explicit manual FX authority. It does not enable foreign transaction entry, change existing reporting readers, register tools, or change Settings/currency-store behavior yet. Complete those adapters together before enabling foreign writes.

- `settings.main_currency` is absent until explicitly set. Absence means configuration needed, not USD. A JSON presentation preference is never promoted automatically.
- `manual_exchange_rates` starts empty. The old `exchange_rates` provider cache is untouched and is not an input to this authority.
- A main-currency switch changes only the setting, audit, and revision; it never relabels source money or evidence.
- Existing budgets/goals acquire `currency TEXT NOT NULL DEFAULT 'USD'`, preserving their evidenced legacy denomination. Future forms must explicitly persist the selected denomination and retain it on edits.

## Pure API (`@shikin/finance-core/fx`, also root exports)

```ts
interface DatedExchangeRate {
  id: string
  fromCurrency: string
  toCurrency: string
  rateDecimal: string
  effectiveFrom: string
  supersedesRateId: string | null
  createdAt: string
  sourceNote: string | null
}

selectEffectiveRate(rates, from, to, asOfDate): DatedExchangeRate | null
convertCentavosAsOf({ amountCentavos, fromCurrency, toCurrency, asOfDate, rates }): DatedConversion
convertDatedAmounts(rows: readonly DatedAmount[], toCurrency, rates)
apportionConvertedAmount(parentConvertedCentavos, allocations, originalParentCentavos)
selectValuationRatesAsOf(rates, toCurrency, asOfDate): ValuationRate[]
```

`DatedAmount` is `{ id, amountCentavos, currency, date }`. All dates are explicit strict Gregorian `YYYY-MM-DD` strings, including midmonth dates. Historical adapters use each transaction/history-point date. Current valuations and planning estimates supply local today. The core has no implicit clock.

A rate means **1 FROM unit = rateDecimal TO units**. Only exact direct pairs are used: no inverse, triangulation, future, provider, or other fallback. Same-currency conversion is exactly 1:1 without a row (`selectEffectiveRate` itself returns null for that pair).

Plain positive decimals are bounded to 80 digits, at most 40 fractional digits. Supported uppercase currencies match the existing app: USD, EUR, GBP, JPY, MXN, BRL, ARS, COP, CLP, PEN, CAD, AUD. Exact conversion reuses valuation's BigInt helpers and rounds half-away-from-zero once at the final centavo. Inputs/results/totals must fit safe integer centavos. Never roundtrip an authoritative decimal through Number.

`DatedConversion` is discriminated by `complete`; `amountCentavos` is a number on success or null with `missingReason: 'missing_direct_rate'`. Both branches retain `fromCurrency`, `toCurrency`, `asOfDate`, `rateId`, `effectiveFrom`, `rateDecimal`, and `direction` (`FROM->TO`); unavailable provenance fields are null.

`convertDatedAmounts` converts each parent separately, returning `complete`, `toCurrency`, nullable `totalCentavos`, `knownTotalCentavos`, sorted `nativeTotals`, sorted `unresolvedIds`, and per-ID `converted` results. Known subtotals must never be labelled complete when unresolved IDs exist. Do not aggregate before conversion.

Apportionment requires unique stable IDs, positive native weights summing exactly to `abs(originalParentCentavos)`, and consistent parent signs. Largest remainders use ascending, locale-independent ID ties; output preserves input order and sums exactly to the converted parent. Refund/expense sign and eligibility remain the reporting adapter's responsibility, not a new classification heuristic.

## Services

The sync CLI module `cli/src/fx-service.ts` and async app module `src/lib/fx-service.ts` expose the same names; the latter returns Promises:

```ts
getCurrencySettings(): CurrencySettings
listExchangeRates(): DatedExchangeRate[] // ALL rows, including superseded history
setMainCurrency(currency: string): CurrencySettings
setExchangeRate(input: SetExchangeRateInput): DatedExchangeRate

type CurrencySettings =
  | { configured: false; mainCurrency: null }
  | { configured: true; mainCurrency: string }

interface SetExchangeRateInput {
  fromCurrency: string
  toCurrency: string
  rateDecimal: string
  effectiveFrom: string
  replacesRateId?: string | null
  sourceNote?: string | null
  auditNote?: string | null
  acknowledgeHistoricalChange?: boolean
  today: string
}
```

Adapters supply **trusted local today**, not a user-controlled public tool argument. Any correction or distinct entry dated before today requires a nonempty audit note (maximum 1000 characters) and `acknowledgeHistoricalChange: true`. Source notes are optional, maximum 1000 characters. Corrections must reference the current leaf ID and retain its pair/date; competing/stale corrections fail atomically. Corrections recalculate historical reports but never accepted transaction amounts or snapshots. There is no rate update/delete service.

Both mutation services validate/read/write/audit inside the existing transaction boundary. Reads do not initialize or migrate. Effects:

| Mutation         | Writes                                           |
| ---------------- | ------------------------------------------------ |
| Set main         | settings, audit_log, app_data_state              |
| Add/correct rate | manual_exchange_rates, audit_log, app_data_state |

Shared helpers include `assertFxCurrency`, `assertFxDate`, `validateRateDecimal`, `planExchangeRate`, `FX_RATE_SELECT`, `FX_RATE_INSERT`, and `exchangeRateBindings`.

## Schema/evidence

Manual rates have snake-case equivalents of the domain fields. Partial unique indexes enforce a single root per pair/date and a single successor per predecessor. SQL guards enforce same-pair/date corrections, append-only history (including REPLACE protection), supported currencies, positive bounded plain decimals and calendar dates.

`transaction_fx_evidence` contains: `id`, nullable live `transaction_id` (FK ON DELETE SET NULL), durable `original_transaction_id`, `original_account_id`, `transaction_type`, `status`, `ledger_treatment`, `input_amount_centavos`, `input_currency`, `account_amount_centavos`, `account_currency`, `account_balance_delta_centavos`, `transaction_date`, nullable `rate_id`, `rate_decimal`, `created_at`.

This is **original input/exchange acceptance evidence**, never authority for a transaction's current status/balance. The signed delta is the resulting snapshot's ledger contribution (+income, -expense, zero for pending/staged/non-impacting rows), **not an edit's incremental balance delta**. Future mutation audit must separately capture actual per-account before/after changes, including reversal and cross-account movement. Originals have no live account FK, so deletion cannot erase their identity. SQL permits only the live transaction FK nulling caused by deletion; other update/delete/REPLACE operations are rejected. Same-currency replacement evidence uses null rate ID, decimal `1`, and equal input/account amounts. No existing transactions are backfilled. The foundation exposes no evidence writer.

## Migration and readiness

`DATED_FX_MIGRATION`, `DATED_FX_VERSION`, `DATED_FX_COLUMNS`, `DATED_FX_SCHEMA`, `DATED_FX_OBJECTS`, `DATED_FX_REVISION_TABLES`, `datedFxStatements`, and `assertDatedFxReady` are root exports. Execute complete statements (do not split triggers) inside one transaction. The 021 revision allowlist remains versioned; the two FX tables have additional 022 revision triggers.

Fresh initialization and supported upgrades are atomic. Restore retains the 019 → 020 → 021 → 022 path, validates latest readiness and rejects future schemas. Existing restore rollback mechanisms preserve live/source data on failure. CLI ordinary reads refuse outdated schemas rather than migrating them. SQLite backups retain main currency, all rate history and retained evidence. Deterministic JSON/CSV/Markdown inventory includes both new tables and budget/goal denominations. Rust snapshot validation is generic; runtime diagnostics now require schema22.

## Remaining adapters and release gate

Not implemented here: main/currency-store setup and Settings UI, the four automation tools and compatible dated convert-currency output, historical/current reporting and valuation consumers, budget/goal forms, foreign input previews/writes/edits, or financial undo guards. Before enabling foreign writes, implement stale-preview rejection, transaction-date resolution inside the transaction, split/transfer restrictions, immutable replacement evidence (including foreign→same-currency edits), actual per-account mutation audit deltas, and generic-undo checks by both live and original transaction ID. Preserve all current import, reconciliation, payment, staging and own-currency behavior. Update public tool contracts/counts only at final integration; no version/release bump belongs to phase A.
