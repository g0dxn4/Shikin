# Feature Ideas

Curated ideas for Shikin's future. Ranked by impact, feasibility, and alignment with the local-first philosophy.

---

## Priority: High

### Savings Goals

Dedicated goal tracking with target amounts, deadlines, and visual progress. Foundation for financial planning — YNAB and Monarch both center around this.

- New `goals` table (id, name, target_amount, current_amount, deadline, account_id, icon, color)
- Dashboard widget showing goal progress
- CLI/MCP tools: `createGoal`, `updateGoal`, `getGoalStatus`
- Budget nudges based on category trends

### Recurring Transactions

Auto-generate expected transactions (rent, salary, utilities) on schedule. Different from subscriptions — these are general recurring entries that reduce manual data entry significantly.

- New `recurring_rules` table (id, template transaction, frequency, next_date, active)
- Background job to materialize upcoming transactions
- CLI/MCP tool: `manageRecurringTransaction`
- Ties into cash flow forecasting

### Cash Flow Forecasting

Project future balance based on upcoming bills, recurring income, and spending patterns. One of the most requested features across all finance apps.

- Leverage recurring transactions + budget data + historical patterns
- 30/60/90 day projections with confidence intervals
- Dashboard chart showing projected balance over time
- CLI/MCP tool: `getForecastedCashFlow`
- Forecast narrative: "You'll dip below $500 on March 28 — consider deferring X"

### Anomaly Detection & Alerts

Proactive notifications for unusual spending, duplicate charges, subscription price increases, and forgotten trials.

- Compare transactions against historical patterns per category/merchant
- Flag outliers (>2σ from mean for that merchant/category)
- Detect duplicate charges (same amount + merchant within 48h)
- Surface in dashboard and reports
- CLI/MCP tool: `getSpendingAnomalies`

### Smart Auto-Categorization

The app learns from user corrections to auto-categorize new transactions by description. Reduces friction for the most common action in the app.

- Merchant-to-category mapping table, seeded from user history
- ML-lite: frequency-based matching for common merchants
- "Suggested category" on transaction form with one-tap accept
- Improves over time without cloud dependency (local pattern matching)

---

## Priority: Medium

### Debt Payoff Planner

Snowball vs avalanche strategy visualization for credit cards and loans. Show payoff timeline, total interest paid, and savings from extra payments.

- New `debts` table or extend credit card fields on accounts
- Strategy comparison view (snowball vs avalanche side-by-side)
- CLI/MCP tool: `getDebtPayoffPlan`
- Monthly debt check-in summary

### Spending Recaps

Auto-generated weekly/monthly natural language summaries. "You spent 23% more on dining this month. Your savings rate improved to 28%."

- Scheduled generation (weekly on Monday, monthly on 1st)
- Store in notebook or dedicated recap table
- Push to dashboard and reports
- Use existing analytics tools for orchestration

### Financial Health Score

Composite score (0-100) based on savings rate, debt-to-income, emergency fund coverage, budget adherence, and investment diversification. Gamification without being gimmicky.

- Weighted formula with transparent breakdown
- Dashboard widget with trend over time
- CLI/MCP tool: `getFinancialHealthScore`
- Actionable tips per sub-score

### Split Transactions

One payment split across multiple categories (e.g., Costco run = groceries + household + electronics). Common real-world need.

- `transaction_splits` table (parent_id, category_id, amount)
- UI: split button on transaction form
- CLI/MCP split support for automation workflows

### Multi-Currency with Live Rates

Auto-fetch exchange rates and convert balances for display. The `exchange_rates` table already exists — needs a fetching service and conversion UI.

- Free API (frankfurter.app or exchangerate.host)
- Scheduled fetch (daily)
- Display all balances in preferred currency
- CLI/MCP tool: `convertCurrency`

### Reports & PDF Export

Monthly/yearly PDF reports with spending breakdowns, income vs expenses, category trends, and net worth changes. Useful for tax prep and personal review.

- Client-side PDF generation (jsPDF or react-pdf)
- Templated reports: monthly summary, annual review, tax export
- CLI/MCP tool: `generateReport`

---

## Priority: Low (Nice to Have)

### OFX/QFX/QIF Import

Bank statement file import beyond CSV. Most banks export these formats. Broadens data import options.

### Receipt Scanning / OCR

Camera-based receipt capture with amount, merchant, and date extraction. Browser camera API + Tesseract.js or cloud OCR.

### Shared / Household Finance

Partner access with shared budgets and split tracking. Significant architecture change for a local-first app — would need sync layer.

### Streaks & Achievements

Gamify daily logging, staying under budget, and hitting savings goals. Fun but not core.

### Financial Education

Contextual teaching — when the user sets up the first budget, explain the 50/30/20 rule. When the user adds the first investment, explain dollar-cost averaging.

### Webhook / Automation Integration

Trigger external actions on financial events. Would require a plugin/extension system.

---

## Rejected / Out of Scope

### Bank Sync (Plaid)

Requires cloud infrastructure, paid API ($), and ongoing maintenance. Conflicts with local-first philosophy. Users can CSV import instead.

### Crypto DeFi Tracking

Too niche and rapidly changing. Basic crypto price tracking via CoinGecko is sufficient.

---

_Last updated: 2026-03-17_
