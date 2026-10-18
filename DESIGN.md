# Shikin Native Design System

Production appearance is defined here. Do not edit
`designs/shikin-native-concept/prototype.html`. That file is a legacy reference for the earlier
native shell. Where it disagrees with this document — palette, chart color, Summary composition, or
account-card framing — production follows this document. Do not copy its fixtures, balances, or
scenario math.

Native light remains the new-install default. Native dark is equally supported. A saved custom theme
stays available and is not rewritten when appearance changes. If the appearance preference is absent
and a valid custom theme is stored, that custom appearance remains selected. If both are absent or
invalid, the app uses native light. Custom presets, font modes, and inline token overrides stay in
effect only while appearance is custom.

## Direction

- **Tone:** calm, precise, and local-first. Ink violet is the only action color. Surfaces are
  neutral. Dark surfaces are equal-channel gray, not tinted canvas, glow, or decorative gradient.
- **Typography:** system-native sans for native appearances. Financial figures use tabular numerals.
  Do not add font downloads. Legacy custom font modes remain valid for saved custom themes.
- **Depth:** solid semantic surfaces, 1px hairlines, modest 6–16px radii, and very soft neutral
  shadows. Avoid heavy frames, blur, glow, gradients, and decorative background grids.
- **Motion:** short functional transitions only; always respect reduced motion.
- **Reference restraint:** observable composition ideas may inform layout, but Sure and the legacy
  prototype are not code, asset, font, or token sources. This foundation does not load them.

## Semantic palette

Use CSS tokens rather than fixed light or dark values in components.

| Role                | Light     | Dark      | Use                                |
| ------------------- | --------- | --------- | ---------------------------------- |
| Canvas              | `#f5f5f2` | `#101010` | Page background                    |
| Sidebar             | `#eeeeea` | `#0c0c0c` | Navigation rail                    |
| Surface / card      | `#ffffff` | `#181818` | Panels and cards                   |
| Elevated            | `#ffffff` | `#1e1e1e` | Popovers and raised surfaces       |
| Foreground          | `#202124` | `#f4f2ec` | Primary text                       |
| Muted foreground    | `#73777e` | `#a7a8ad` | Secondary text                     |
| Hairline            | `#deded8` | `#3a3a3a` | Panel and rail borders             |
| Control boundary    | `#deded8` | `#6e6e6e` | Inputs and stronger control edges  |
| Selected / muted    | `#deded8` | `#262626` | Neutral chips, not a colored wash  |
| Sidebar selection   | `#ffffff` | `#262626` | Active nav chip on the rail        |
| Filled action       | `#6f29ae` | `#9448d8` | `primary`, white label only        |
| Text / link / focus | `#6f29ae` | `#c4a0e3` | `accent` and focus ring            |
| Positive            | `#18783c` | `#4dcc78` | Income and success; unchanged      |
| Warning             | `#a96108` | `#e9a84d` | Unchanged                          |
| Destructive         | `#c43b3b` | `#f07474` | Expense and destructive; unchanged |

`primary` and `accent` are separate tokens. In light they share the same ink; in dark they do not.
The dark filled action (`#9448d8` on white, about 5.03:1) is not legible as small text on a card
(about 3.53:1). Text, links, icons, and focus use `accent` (`#c4a0e3` on the card, about 8.02:1).
Link buttons use `text-accent`, not `text-primary`.

If a control uses `bg-accent`, its label uses `accent-foreground`. That is white on the deep light
ink and dark text (`#101010`) on the pale dark accent. Do not put white text on the pale dark accent.

Selection and muted surfaces replace the old blue chips with neutral surfaces. Do not reintroduce a
colored canvas, selection wash, glow, or decorative gradient.

Category colors remain user/domain colors and are unchanged. Status colors communicate meaning and
must not be reassigned decoratively.

### Chart series

Keep the series roles. Do not paint history or forecast area washes with `primary` or `accent`; that
turns the field violet. Use `chart-1` for the neutral history wash.

| Token     | Role                                                                 | Light     | Dark      |
| --------- | -------------------------------------------------------------------- | --------- | --------- |
| `chart-1` | Net worth, current month, and the first comparison series            | `#3b362b` | `#e6e1d6` |
| `chart-2` | Positive series and the second comparison series; same as success    | `#18783c` | `#4dcc78` |
| `chart-3` | Expenses and the cool neutral series; also snowball text, so legible | `#44525f` | `#a9b7c4` |
| `chart-4` | Warning series                                                       | `#a96108` | `#e9a84d` |
| `chart-5` | Destructive series                                                   | `#c43b3b` | `#f07474` |

Light `chart-1` is the warm ink corresponding to the dark bone series. Light `chart-3` is the cool
slate corresponding to the dark cool-gray series. Neither is violet. Grid and axis colors stay
neutral. Chart grids, axes, legends, and tooltips use the shared CSS-variable contracts in
`src/lib/constants.ts`.

## Visual-first hierarchy

- Lead financial views with one useful chart, ring, calendar, or track, not a wall of explanations or
  duplicate metric strips. Secondary numbers support the graphic.
- Use compact legends and date, currency, scope, and status chips. Keep incomplete, overdue, and
  unsafe states obvious. Method prose, detailed filters, evidence, and full tables belong on demand,
  with keyboard and screen-reader access preserved.
- A line needs real dated points; a share needs a valid denominator. Empty or incomplete data never
  gets a decorative financial graph. Quantitative widths are not inflated for decoration.
- Primary recorded-balance figures are proper charts, not axisless stretched sparklines: visible
  date and currency-aware value ticks, useful plot height, real elapsed-time spacing, and exact
  data/inspection alternatives. Keep range/display controls content-sized below the plot, aligned
  right, rather than a full-width empty track. See [Financial chart design](docs/reference/FINANCIAL_CHARTS.md).
- Utility screens lead with appearance previews, category icons, and capability tiles, not fake
  financial charts. Prefer fewer default words and clearer visual groups.

## Production layout

- Desktop uses a full-height 216px sidebar, collapsing persistently to 72px.
- The sidebar exposes six groups: Overview, Transactions, Accounts, Planning, Insights, Settings.
  Multi-route groups expand to show indented destinations, including the group home route. The 72px
  rail keeps every group reachable and expands before revealing a multi-route group's destinations.
- The shell keeps one screen-reader-only route `h1`; do not add a visible title-only header bar or
  cross-page tab row. Tabs switch views within one page. Route navigation belongs in the sidebar and
  the grouped mobile More sheet.
- Overview keeps Summary, History, and Compare as mounted tabs in the finance panel. Summary uses
  compact current/monthly figures with a larger full-width recorded-history chart and compact
  bottom-right controls. Current net worth remains an independent headline with its as-of and
  completeness state; selecting history never replaces it. Real dates and money axes explain the
  plot. Sparse/unavailable history has a truthful fallback, not an invented trend or violet wash.
  History and Compare retain explicit dates, currencies, conversion, and missing-data states.
- Accounts are single-frame cards with room for a readable recorded-history figure: at most two
  columns on desktop and one on mobile. Do not nest a card in a second bordered panel or retain a
  tiny unlabeled sparkline above a second history chart. Empty/single/unchanged history is explicit,
  not a giant empty plot or fake line. Native balances, debt signs, and real cache coverage stay
  visible. The asset/liability mix remains a compact supporting section after the collection, not
  a sparse sidebar. Budgets retain a full-width primary section and compact intelligence.
- Transactions is one coherent record workspace, not a stack of technical dashboard cards: compact
  search/actions, visible Timeline/Ledger/Review modes, clear filters, and a dense journal/table or
  focused review inspector. Actual records lead. Review counts remain scoped worded counts with
  overlap context, not a paginated money chart or an approval claim.
- Planning and Insights are data-led. Charts, mixes, and scenarios may only show recorded or
  explicitly calculated data. Do not fabricate series, sample balances, or decorative charts. Do not
  add incompatible currencies, overlapping plans, or independent recurring estimates. Incomplete FX
  or coverage stays incomplete, never zero.
- Mobile uses Overview, Transactions, Accounts, and More. More exposes all 18 destinations grouped
  by the same six sections. Insights opens Reports and groups Reports, Net Worth, Spending Insights,
  and Heatmap; Forecast remains in Planning. Content reserves the bottom safe area.
- Pages own filters and actions locally. Do not introduce globally shared financial filter state.

## Shared presentation vocabulary

- `PageToolbar`: compact page-owned filters/actions row; never renders the route title.
- `NativePanel`: semantic bordered section/article/div surface.
- `MetricStrip` and `MetricItem`: compact comparable summary values.
- Existing buttons, inputs, badges, dialogs, sheets, filter pills, progress, stat rows, pagination,
  and charts use semantic native tokens. Filled actions use `bg-primary text-primary-foreground`.
  Small accent text and links use `text-accent`.

Keep interfaces dense enough for financial work, but provide 44px mobile targets and visible keyboard
focus. Preserve chart headings, legends, dates, accessible data alternatives, field labels, dialog
focus behavior, and destructive confirmations.
