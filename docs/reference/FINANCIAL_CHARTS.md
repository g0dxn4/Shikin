# Financial chart design

This is the production contract for primary recorded-balance charts. It follows the October 2026
chart-clarity research and replaces the earlier assumption that a primary chart can be a stretched
sparkline with its axes hidden. See [DESIGN.md](../../DESIGN.md) for the native palette and shell.

## Start with the reading task

A reader should identify the measure, dates, currency, available coverage, and direction without
hovering. They must distinguish current valuation, latest recorded balance, and a selected historical
record. Axes alone do not meet that goal: overlapping labels, ambiguous units, and equally spaced
irregular dates still mislead.

| Reading task                          | Appropriate presentation                                             | Required context                                                     |
| ------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Recorded balance over time            | Linear line, with recorded-point markers and visible date/money axes | Currency, actual record dates/count, coverage, latest record         |
| Current valuation                     | Full monetary figure, independent of chart selection                 | Current/as-of and completeness state                                 |
| Magnitude or optional filled history  | Zero-based bars or area; include negative values                     | Currency, zero baseline, actual record dates                         |
| Credit utilization or budget progress | Labeled meter from zero to a real capacity                           | Numerator, denominator, currency/window                              |
| Composition                           | Directly labeled parts of a named total                              | Currency, complete denominator; no inflated minimum shares           |
| Review flags                          | Worded counts; reasons may overlap                                   | Filter scope and overlap, never an implicit percentage or money axis |

Transactions are the primary content on Transactions. A paginated result is not a financial time
series. Do not add income, expenses, savings, profit, or cash-flow charts by summing the current page
or subtracting balance snapshots.

## Recorded data is not an inferred daily path

- Plot the records returned by the existing reader, retaining signed integer centavos and currency.
  Do not append the current balance, fill dates, synthesize boundary values, or smooth a curve.
- Use elapsed UTC calendar time for positioning date-only financial records. A one-day interval must
  not occupy the same width as a month. Preserve the original ISO date for tables and inspection.
- Date-to-epoch conversion must validate and round-trip the original `YYYY-MM-DD`; do not silently
  normalize an invalid date. Format tick dates in UTC, not the viewer's offset timezone.
- A linear segment joins observations; it is not proof of balances between them. Identify the figure
  as recorded history. Explain the join/coverage on demand, without a technical paragraph by default.
- Preserve missing-data and FX refusals. Unknown, incomplete, and unconfigured are not zero. Do not
  connect across a known invalid observation or invent an exchange rate.
- A zero-record window has no trend. One record has a dated value, not a line. Constant records can
  use a concise unchanged-balance presentation and an exact table, not a fabricated ±1 scale.
- Selecting a past record never replaces the current valuation headline. Show selected and latest
  recorded values as distinct, explicitly named readouts.

## Time ranges and coverage

The Overview range must continue to request the existing real `month`, `3m`, `6m`, `1y`, or `all`
read. Month-to-date is not a rolling month. MAX is not a slice of a six-month cache.

Account cards currently load a six-month batch. Show the actual queried start and observed dates;
do not call that cache MAX, daily coverage, or history since account opening. Holdings quotes are
not account-balance history.

Use the observed record extent for plot geometry, especially MAX: the adapter's 1970 lower bound is
not an account opening date and must not create fifty years of empty plot. The caption separately
identifies the requested/available window. Axis ticks may be calendar positions without an
observation; they are not additional data points.

## Scales and numeric precision

### Lines

A zero baseline is not mandatory for a balance line. Use a padded data domain, with zero included
when the series crosses zero or is near it. Keep negative account balances negative.

Our product choice is approximately 8% span padding, with a small magnitude-relative floor (about
0.5% of the largest absolute value) to prevent a few centavos from becoming a full-height slope.
These are axis bounds, not new balances. They are design choices, not published research thresholds.
Constant and sparse data must not become a manufactured trend.

### Bars and areas

Length and filled area imply magnitude. Include zero and the negative minimum. Do not fill a
padded, nonzero line domain as if it were an amount measured from zero. Switching display style
must not change the underlying dates or money.

### Ticks

- Use a few distinct labels: usually two or three X labels on a phone and three to five on desktop;
  three or four Y labels where practical. Never rotate or overlap text to squeeze every record in.
- Axis numbers can be compact; tooltips, readouts, and exact tables cannot. Always pass currency
  explicitly. The figure visibly states the ISO code; `$` alone is ambiguous.
- Choose precision using the tick values actually drawn. If two different ticks format identically,
  increase precision or use full dollars/cents. Do not show several `$0.2K` labels for a cash balance
  between $166 and $182, or lose the minus on a card balance.
- Size the Y band for its longest label. Do not clip signs, currency, or digits into a fixed narrow
  gutter. Keep mobile plot width useful by letting the plot use the card's inner edges.

## Layout and controls

Use a proper figure, not a full-width 48px or 112px strip. Target an inner plot about 220px tall
(roughly a 280–300px chart box after axis bands). Account cards with real history are larger and at
most two columns on desktop, one on mobile. Empty/single/unchanged states must not reserve a giant
empty graph. The full-width Overview figure avoids an unused rail beside a narrow chart.

Controls belong below the plot, right-aligned and content-sized. Do not stretch a muted segmented
track across unused space. Desktop controls are about 32px high; touch controls remain at least
44×44 CSS px, wrapping into end-aligned rows when necessary. Keep range, inspection, and optional
chart display controls coherent rather than adding another dashboard of buttons.

Show current numbers and a concise figure caption. Put method explanations and exact data on demand.
Do not carry research debug text, raw centavos, duplicate totals, or permanently open tables into the
production layout.

## Accessibility and paint

- Use 11–12px or larger axis text. It is normal-sized text: require an unrounded contrast ratio of
  at least 4.5:1. Native light's existing muted axis token is borderline; new primary figures may
  use the foreground token rather than changing the native palette.
- Required data strokes need at least 3:1 against their painted background. Use a visible stroke
  around 2px. Grids are quiet guides, never the sole scale.
- Check actual alpha/color-mix compositing. A token-pair calculation is insufficient when the glyph
  is painted over a tinted card. Preserve the custom semantic-color contrast corrections.
- Provide a visible short caption and a real semantic table of the same dates/amounts, outside an
  image/application role. A table referenced only by `aria-describedby` loses its structure.
- Provide visible keyboard/touch point inspection with full date and money. Dense markers may stay
  small when the same action has accessible previous/next controls. No focusable elements in clipped
  one-pixel table regions.
- Tooltips are conveniences, not the only information channel. Keep them dismissible and do not
  display an interpolated value between observations.

The project's 44px touch target is stricter than WCAG 2.2 AA's 24px minimum; 44px is the enhanced
criterion. Do not misattribute those numbers.

## Verification

Check desktop 1600px and mobile 320/375px, EN/ES, native light/dark, and representative saved custom
themes. Measure inner plot, tick/toolbar rectangles, painted contrast, point/table counts, signed
values, and irregular time-coordinate ratios. Check sparse, constant, missing-FX, unsupported-
currency, and loading states with nearest unit tests.

A human reading check asks: what are X and Y, which currency and window, what direction, and which
value is current/latest/selected? Our five-second heuristic is a product evaluation task, not a WCAG
criterion or a claim of an external user study. Semantic readiness alone does not approve appearance.

## Evidence and limits

Research inspected public examples from Copilot, Monarch, Lunch Money, Actual Budget, and Sure,
including the distinction between a small redundant sparkline and a primary chart. Their visual
patterns are references, not code, assets, fonts, colors, or financial data to copy.

- [Datawrapper: line charts](https://www.datawrapper.de/academy/what-to-consider-when-creating-line-charts)
- [Datawrapper: zero baselines for bars](https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero)
- [Datawrapper: patchy data](https://www.datawrapper.de/academy/patchy-data)
- [Observable Plot: scales](https://observablehq.com/plot/features/scales)
- [Correll, Bertini, Franconeri: truncation perception](https://arxiv.org/abs/1907.02035)
- [FT Visual Vocabulary](https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md)
- [WAI: complex images](https://www.w3.org/WAI/tutorials/images/complex/)
- [WCAG: text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG: non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [WCAG: minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [NN/g: choosing chart types](https://www.nngroup.com/articles/choosing-chart-types/)
- [Copilot: Accounts tab](https://help.copilot.money/en/articles/6213732-accounts-tab-overview)
- [Lunch Money: Net Worth](https://support.lunchmoney.app/home/net-worth)
- [Actual: reports](https://actualbudget.org/docs/reports/)

A snapshot difference is not profit or cash flow. The [IFRS Conceptual Framework](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2026/issued/cf.html)
and [IAS 7](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2026/issued/ias7.html)
provide the underlying distinction; no accounting classification is inferred by a chart.
