# Shikin Design System

Shikin uses a premium, Apple-like dark interface for a local-first personal finance app. The design should feel calm, private, precise, and native rather than decorative.

## Design Direction

- **Name:** Apple Liquid Finance
- **Tone:** premium, clean, private, focused
- **Primary metaphor:** black titanium base with liquid-glass financial surfaces
- **Core promise:** financial clarity without visual noise
- **Design source of truth:** `designs/shikin-apple-core.pen`

## Principles

1. **Content first:** money, trends, and actions lead every screen.
2. **Liquid depth:** use dark glass surfaces, subtle borders, and restrained gradients to create hierarchy.
3. **Native density:** desktop can be dense and command-oriented; mobile stays single-column and thumb-friendly.
4. **Color has a job:** violet is action, green is income, amber is spending, neutral colors carry structure.
5. **Large numbers matter:** monetary values should be prominent, tabular, and easy to compare.
6. **Local-first trust:** privacy and local storage should appear as product benefits, not legal footnotes.

## Color Tokens

| Token | Value | Usage |
| --- | --- | --- |
| Background | `#020203` | App canvas |
| Surface | `#101016` | Cards, rails, panels |
| Surface subtle | `#FFFFFF0F` | Inputs, segmented controls |
| Border | `#FFFFFF14` | Default hairline border |
| Border strong | `#FFFFFF18` | Elevated/hero border |
| Text | `#FFFFFF` | Primary text |
| Text muted | `#A9A9B4` | Secondary labels |
| Text soft | `#C6C6CF` | Metadata and helper copy |
| Accent | `#7C5CFF` | Primary actions |
| Accent light | `#BFA4FF` | Highlights, active icons |
| Income | `#34D399` | Positive amounts and success states |
| Spending | `#F59E0B` | Expenses and warnings |

## Typography

- **Display:** Space Grotesk for titles, section headers, and brand moments.
- **Body:** Outfit for labels, descriptions, navigation, and form text.
- **Numbers:** Space Mono for all currency, percentages, and account identifiers.

Recommended scale:

| Role | Size | Weight |
| --- | --- | --- |
| Desktop page title | 28px | 700 |
| Desktop hero amount | 48-54px | 700 |
| Card title | 21-24px | 700 |
| Body/action text | 14-16px | 600-700 |
| Mobile title | 28px | 700 |
| Mobile hero amount | 34-36px | 700 |

## Layout

### Desktop

- Canvas: `1440 x 1024`.
- Sidebar: `280px` wide, `24px` from edges, `28px` radius.
- Main content starts at `x=328` with `24px` rhythm.
- Header toolbar: `72px` tall, `24px` radius.
- Cards use `28-32px` radius for premium surfaces.
- Prefer bento layouts with one dominant hero region and supporting cards.

### Mobile

- Canvas: `390 x 844`.
- Page padding: `18px`.
- Bottom navigation: floating pill, `330 x 62`, `30px` from left.
- Mobile screens should use one dominant column and avoid multi-panel density.
- Keep primary actions within thumb reach.

## Components

### Sidebar

- Dark glass rail with a strong active state.
- Active item uses `#FFFFFF14` fill and white text.
- Inactive items use muted text and no heavy container.

### Toolbar

- Contains the page title, short contextual subtitle, and one primary action.
- Avoid multiple equally prominent actions.

### Hero Cards

- Use violet-to-black gradients only for important summary surfaces.
- Large monetary value must be the strongest element.
- Include one clear status or trend line.

### Data Cards

- Use `#101016` fill with `#FFFFFF14` stroke.
- Keep labels small and muted.
- Use Space Mono for amounts.

### Charts

- Use simplified bars and blocks in Pencil mockups.
- Accent bars should be violet; positive trends can use green.
- Avoid rainbow palettes unless category comparison requires it.

## Screen Set

Current Pencil system includes:

- `00 Direction — Apple Liquid Finance`
- `D-01 Premium Dashboard`
- `D-02 Transactions`
- `D-03 Accounts`
- `D-04 Budgets`
- `D-05 Bills`
- `D-06 Reports`
- `D-07 Goals`
- `D-08 Settings`
- `D-09 Investments`
- `D-10 Subscriptions`
- `D-11 Debt Payoff`
- `D-12 Forecast`
- `D-13 Net Worth`
- `D-14 Spending Insights`
- `D-15 Spending Heatmap`
- `D-16 Memories`
- `D-17 Extensions`
- `M-01 Premium Home`
- `M-02 Transactions`
- `M-03 Accounts`
- `M-04 Budgets`
- `M-05 Bills`
- `M-06 Reports`
- `M-07 Settings`
- `M-08 Goals`

The Pencil canvas is organized as:

- Direction frame at the top.
- Desktop screens in route order across multiple rows.
- Mobile screens in one grouped row.

Routed desktop coverage mirrors `src/App.tsx`: Dashboard, Transactions, Accounts, Budgets, Goals, Investments, Subscriptions, Debt Payoff, Forecast, Net Worth, Spending Insights, Spending Heatmap, Memories, Settings, Bills, Reports, and Extensions.

## Copy Voice

- Clear, direct, and reassuring.
- Prefer “Your data is local by default” over generic security language.
- Avoid playful finance copy, emojis, and overly casual labels.
- Use specific financial insights when possible.

## Implementation Notes

- Preserve forced dark mode.
- Do not introduce a light theme unless the product direction changes.
- Use violet only for action/highlight states, not as a general decoration.
- All money values should be aligned and rendered with tabular/mono styling.
- Any future app implementation should first match the Pencil file, not reinterpret the brand from scratch.
