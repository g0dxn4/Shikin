# Shikin Native Design System

Shikin uses the approved native production direction in
`designs/shikin-native-concept/prototype.html` and its desktop, dark, collapsed, and settings
references. The prototype defines presentation and information architecture only; production pages
must keep their real data, workflows, protections, and React Router paths.

## Direction

- **Tone:** calm, precise, local-first, and Apple-like without imitating ornamental glass effects.
- **Appearance:** native light is the new-install default, with an equally supported graphite native
  dark mode. A separately saved custom theme remains available under advanced appearance controls.
- **Typography:** system-native sans for native appearances. Financial figures use tabular numerals.
  Legacy custom font modes remain valid for saved custom themes.
- **Depth:** solid semantic surfaces, hairline borders, modest 8–14px radii, and very soft shadows.
  Avoid heavy blur, glow, gradients, and decorative background grids.
- **Motion:** short functional transitions only; always respect reduced motion.

## Semantic palette

Use CSS tokens rather than fixed light or dark values:

| Role             | Light reference | Dark reference |
| ---------------- | --------------- | -------------- |
| Canvas           | `#f5f5f2`       | `#18191b`      |
| Sidebar          | `#eeeeea`       | `#121315`      |
| Surface          | `#ffffff`       | `#222326`      |
| Foreground       | `#202124`       | `#f3f3f1`      |
| Muted foreground | `#73777e`       | `#a3a5aa`      |
| Border           | `#deded8`       | `#3b3c40`      |
| Action           | `#276fd6`       | `#66a4f4`      |
| Positive         | `#18783c`       | `#4dcc78`      |

Category colors remain user/domain colors. Status colors communicate meaning and must not be
reassigned decoratively. Chart grids, axes, legends, and tooltips use the shared CSS-variable
contracts in `src/lib/constants.ts`.

## Production layout

- Desktop uses a full-height 216px sidebar, collapsing persistently to 72px.
- The sidebar exposes six groups: Overview, Transactions, Accounts, Planning, Insights, Settings.
- The shell keeps one screen-reader-only route `h1`; do not add a visible title-only header bar.
  Multi-route groups expose contextual tabs at the top. Overview has no empty header or one-item tabs.
- Overview's full-width finance panel offers Summary, History, and Compare accounts views rather
  than a permanent left-summary/right-chart split. Keep account comparisons based on recorded
  balance history with explicit dates, currency conversion, and missing-data states.
- Accounts and Budgets use full-width primary sections, followed by compact supporting sections
  (asset/liability mix and budget intelligence). Avoid sparse right-hand sidebars on these pages.
- Mobile uses Overview, Transactions, Accounts, and More. More exposes all 19 destinations grouped
  by the same six sections. Content reserves the bottom safe area.
- Pages own filters and actions locally. Do not introduce globally shared financial filter state.

## Shared presentation vocabulary

- `PageToolbar`: compact page-owned filters/actions row; never renders the route title.
- `NativePanel`: semantic bordered section/article/div surface.
- `MetricStrip` and `MetricItem`: compact comparable summary values.
- Existing buttons, inputs, badges, dialogs, sheets, filter pills, progress, stat rows, pagination,
  and charts use semantic native tokens.

Keep interfaces dense enough for financial work, but provide 44px mobile targets and visible keyboard
focus. Preserve chart headings, legends, dates, accessible data alternatives, field labels, dialog
focus behavior, and destructive confirmations.
