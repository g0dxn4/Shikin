# Shikin — native concept

A standalone, interactive design preview for a calm, Apple-like personal-finance workspace. It demonstrates screen and navigation coverage only; it is not production feature parity.

## Open

Open `index.html` for the gallery or `prototype.html` for the primary preview. Both work from `file://` without a server, build step, dependency, database, or network connection.

Default state: September 2026 · all accounts · light appearance · 6-month chart range.

## Complete route map — 19 screens / 6 desktop groups

| Desktop group | Destinations |
| --- | --- |
| Overview | `#/overview` |
| Transactions | `#/transactions`, `#/categories` |
| Accounts | `#/accounts`, `#/investments`, `#/receivables` |
| Planning | `#/budgets`, `#/goals`, `#/bills`, `#/bill-calendar`, `#/debt-payoff`, `#/forecast` |
| Insights | `#/insights`, `#/reports`, `#/net-worth`, `#/spending-insights`, `#/spending-heatmap` |
| Settings | `#/settings`, `#/extensions` |

Desktop uses six visible primary destinations plus a section tab row. The 72px collapsed rail keeps those six groups visible with labels/tooltips and a visible `DEMO` indicator. The expanded rail has a labeled **Collapse** control in its footer.

Mobile uses Overview, Transactions, Accounts, and an accessible **More** dialog. More exposes Planning, Insights, Settings, and every destination under them. Hash routes restore on direct load and work with browser back/forward navigation.

## Representative interactions

- **Overview:** month/account scope, 1M/3M/6M/1Y balance range, chart inspection, expandable categories, category-to-ledger drill-down.
- **Transactions:** search, category context, pagination, account/month filtering, keyboard-selectable rows, read-only transaction detail.
- **Categories:** search/type filter and category-to-ledger inspection.
- **Accounts:** reconciled asset/liability snapshot and account-to-filtered-ledger drill-down.
- **Investments:** holdings search and read-only valuation detail; holdings total the brokerage balance.
- **Receivables:** status filter and read-only receivable detail.
- **Budgets:** ledger-backed category progress and a local-only planned-groceries scenario.
- **Goals:** select a goal to inspect progress and a contribution scenario.
- **Bills / Calendar:** status filter, recurring-rule detail, month grid, date selection, and paid/remaining summary.
- **Debt payoff:** avalanche/snowball comparison and validated extra-payment scenario with an explicit hypothetical disclosure.
- **Forecast:** 30/60/90-day horizon and baseline/optimistic/pessimistic assumptions.
- **Insights / Reports / Net worth:** linked summary hub, period reconciliation, shared snapshot math, and range selection.
- **Spending insights / Heatmap:** trend tabs, honest unavailable YoY state, ledger-backed daily calendar, and day transaction drill-down.
- **Preferences:** persistent light/dark appearance and safe sample-JSON download; unsupported settings are marked preview/read-only.
- **Extensions:** local capability cards and copyable illustrative commands, accurately marked demo/not connected.

Appearance and sidebar collapse persist in local browser storage. Scenario edits live only for the page session.

## Screenshot set

| File | Viewport / state |
| --- | --- |
| [`prototype-desktop.png`](prototype-desktop.png) | Overview, light, 1440×900, expanded |
| [`prototype-dark.png`](prototype-dark.png) | Overview, dark, 1440×900, expanded |
| [`prototype-transactions.png`](prototype-transactions.png) | Transactions, light, 1440×900 |
| [`prototype-collapsed.png`](prototype-collapsed.png) | Overview, light, 1440×900, collapsed rail |
| [`prototype-accounts.png`](prototype-accounts.png) | Accounts, light, 1440×900 |
| [`prototype-planning.png`](prototype-planning.png) | Planning / Budgets, light, 1440×900 |
| [`prototype-insights.png`](prototype-insights.png) | Insights / Spending heatmap with selected day, light, 1440×900 |
| [`prototype-settings.png`](prototype-settings.png) | Settings / Preferences, light, 1440×900 |
| [`prototype-mobile-overview.png`](prototype-mobile-overview.png) | Mobile Overview without navigation overlay, light, 390×844 |
| [`prototype-mobile.png`](prototype-mobile.png) | Mobile More navigation, light, 390×844 |

## Initial static concept — preserved

The following initial artifacts remain untouched:

- `shikin-native-concept.pen`
- `overview-light.png`
- `overview-dark.png`
- `transactions-light.png`
- `overview-mobile.png`

Initial canvas frame IDs: Overview Light `A9xtO`, Overview Dark `ogVPN`, Transactions Light `NHP2H`, Overview Mobile `Zw7wX`.

## Synthetic-data boundaries

- All balances, transactions, receivables, bills, goals, holdings, and scenarios are deterministic sample content.
- Transactions cover August–October 2026 and use integer cents with explicit income, expense, and transfer types.
- Transfers are excluded from income, spending, budget actuals, reports, forecasts, and cash-flow totals.
- Shared transaction data drives Overview, Transactions, Categories, Budgets, Reports, Spending insights, and Heatmap.
- The September 30 account snapshot is $295,701.40: checking $12,480.20, Apple Card −$1,840.30, Sapphire Reserve −$3,240.60, and brokerage $288,302.10.
- Balance history is a separate deterministic snapshot series and is never equated with monthly cash-flow savings.
- Forecast and debt-payoff outputs are explicitly hypothetical, simplified scenarios—not financial advice.
- No authentication, real CRUD, backup/import, institution sync, API key, market feed, install/update service, or chat assistant is present.

## Integrated-review delta

| ID | Status | Fix |
| --- | --- | --- |
| M1 | Fixed | Mobile header and filters now reserve their real flow height; content clears the sticky section tabs. The redundant Overview-only tab row is omitted. |
| R1 | Fixed | Overview category drill-down uses the hash router, preserving filter state and correct back/forward navigation. |
| R2 | Fixed | Mobile selection follows route groups: Categories selects Transactions; Investments and Receivables select Accounts; More is limited to Planning, Insights, and Settings. |
| R3 | Fixed | Category and holdings search restore focus, caret, and selection after their bounded result rerender. |

## Validation performed

- Loaded every route directly by hash and verified its expected page title, visible content, selected desktop group, and zero document-level horizontal overflow at 1440×900.
- Exercised desktop sidebar/subnav routing, account-to-ledger routing, transaction search, category/holdings search, receivable and bill filters, budget scenario, forecast horizon/case, calendar selection, heatmap day drill-down, net-worth range, theme switching, and sidebar persistence.
- Checked mobile at 390×844: four primary destinations, More dialog focus/close behavior, route selection, selected More state, and zero document-level horizontal overflow.
- Checked JavaScript syntax with `node --check` and browser console output during the route pass.

The initial `.pen` canvas and `designs/shikin-apple-core.pen` were not modified.
