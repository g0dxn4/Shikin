import {
  budgetWindowComparability,
  inspectReportScope,
  resolveBudgetScope,
} from '@shikin/finance-core'
import { getCurrencySettings } from '../fx-service.js'
import { mainCurrencySetupNeeded, readCurrentAmounts } from '../dated-read.js'
import {
  loadScopedDataset,
  scopedActual,
  contributorInspection,
  storedBudgetScope,
} from '../scoped-report-read.js'
import { readMainOwnershipValuation } from '../valuation-read.js'
import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  boundedText,
  positiveMoneyAmount,
  currencyCode,
  resolveCategoryId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type BudgetRow = {
  id: string
  name: string
  amount: number
  currency: string
  period: 'weekly' | 'monthly' | 'yearly'
  category_id: string | null
  category_name: string | null
  scope_json: string
  basis: 'gross_cashflow' | 'net_consumption'
  is_active: number
}
const budgetSelect = `SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id`
const scopeSchema = z
  .object({
    accountIds: z.array(z.string()).optional(),
    excludeAccountIds: z.array(z.string()).optional(),
    categoryIds: z.array(z.string().nullable()).optional(),
    excludeCategoryIds: z.array(z.string().nullable()).optional(),
    tags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
  })
  .strict()
const fields = {
  budgetId: boundedText('Budget ID', 'Stable budget ID', 128).optional(),
  categoryId: boundedText('Category ID', 'Exact category ID', 128).nullable().optional(),
  categoryName: boundedText('Category name', 'Category name', 120).optional(),
  scope: scopeSchema
    .optional()
    .describe('Exact source-account, allocation-category and recognition-tag scope'),
  currency: currencyCode('Stored plan currency; changing it requires amount').optional(),
  basis: z.enum(['gross_cashflow', 'net_consumption']).optional(),
  amount: positiveMoneyAmount('Amount in the plan currency').optional(),
  period: z.enum(['weekly', 'monthly', 'yearly']).optional(),
  name: boundedText('Budget name', 'Budget name', 120).optional(),
  active: z.boolean().optional(),
  dryRun: z.boolean().optional().default(false),
}
type BudgetInput = z.infer<z.ZodObject<typeof fields>>
function budgetSnapshot(row: BudgetRow) {
  return {
    id: row.id,
    name: row.name,
    amount: fromCentavos(row.amount),
    amountCentavos: row.amount,
    currency: row.currency,
    period: row.period,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    scope: storedBudgetScope(row),
    basis: row.basis,
    isActive: row.is_active === 1,
  }
}
function findBudget(input: BudgetInput, categoryId: string | null): BudgetRow | null {
  if (input.budgetId)
    return query<BudgetRow>(`${budgetSelect} WHERE b.id = $1`, [input.budgetId])[0] ?? null
  if (categoryId) {
    const rows = query<BudgetRow>(
      `${budgetSelect} WHERE b.category_id = $1 ${input.period ? 'AND b.period = $2' : ''} ORDER BY b.is_active DESC, b.name, b.id LIMIT 2`,
      input.period ? [categoryId, input.period] : [categoryId]
    )
    if (rows.length > 1)
      throw new Error('Multiple budgets match this category. Supply budgetId or period.')
    if (rows.length) return rows[0]
  }
  if (input.name) {
    const rows = query<BudgetRow>(
      `${budgetSelect} WHERE LOWER(b.name) = LOWER($1) ORDER BY b.is_active DESC, b.name, b.id LIMIT 2`,
      [input.name]
    )
    if (rows.length > 1) throw new Error('Multiple budgets match this name. Supply budgetId.')
    return rows[0] ?? null
  }
  return null
}
function resolveCategory(input: BudgetInput) {
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) return { id: null, name: null }
    const row = query<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE id = $1',
      [input.categoryId]
    )[0]
    if (!row) throw new Error(`Category ${input.categoryId} not found.`)
    return row
  }
  if (!input.categoryName) return { id: null, name: null }
  const result = resolveCategoryId(input.categoryName)
  if (!result.success) throw new Error(result.message)
  return { id: result.id, name: result.name }
}
function saveBudget(input: BudgetInput, mode: 'create' | 'upsert') {
  if (
    mode === 'upsert' &&
    !input.budgetId &&
    !input.name &&
    !input.categoryId &&
    !input.categoryName
  ) {
    return {
      success: false,
      reason: 'budget_stable_match_required',
      message:
        'Provide budgetId, name, categoryId, or categoryName so upsert-budget has a stable match key.',
    }
  }
  return transaction(() => {
    const category = resolveCategory(input)
    const existing =
      input.budgetId && mode === 'create'
        ? (query<BudgetRow>(`${budgetSelect} WHERE b.id = $1`, [input.budgetId])[0] ?? null)
        : mode === 'upsert'
          ? findBudget(input, category.id)
          : null
    const scopeDefinition = resolveBudgetScope({
      ...(existing
        ? { storedScope: JSON.parse(existing.scope_json), storedCategoryId: existing.category_id }
        : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.categoryId !== undefined || input.categoryName !== undefined
        ? { categoryId: category.id }
        : {}),
    })
    const references = inspectReportScope(scopeDefinition.scope, {
      accounts: query<{ id: string }>('SELECT id FROM accounts'),
      categories: query<{ id: string }>('SELECT id FROM categories'),
    })
    if (references.issues.length)
      throw new Error(references.issues.map((issue) => issue.message).join('; '))
    const settings = getCurrencySettings()
    if (!existing && !input.currency && !settings.configured) return mainCurrencySetupNeeded
    if (!existing && input.amount === undefined)
      return { success: false, message: 'amount is required when creating a budget.' }
    if (
      existing &&
      input.currency &&
      input.currency !== existing.currency &&
      input.amount === undefined
    ) {
      return {
        success: false,
        reason: 'amount_required_for_currency_change',
        message:
          'Changing currency requires an explicit new amount; amounts are not converted automatically.',
      }
    }
    const after: BudgetRow = {
      id: existing?.id ?? input.budgetId ?? generateId(),
      name: input.name ?? existing?.name ?? (category.name ? `${category.name} Budget` : 'Budget'),
      amount: input.amount === undefined ? existing!.amount : toCentavos(input.amount),
      currency: input.currency ?? existing?.currency ?? settings.mainCurrency!,
      period: input.period ?? existing?.period ?? 'monthly',
      category_id: scopeDefinition.categoryId,
      category_name:
        scopeDefinition.categoryId === existing?.category_id
          ? (existing?.category_name ?? null)
          : category.name,
      scope_json: JSON.stringify(scopeDefinition.scope),
      basis: input.basis ?? existing?.basis ?? 'gross_cashflow',
      is_active: input.active === undefined ? (existing?.is_active ?? 1) : input.active ? 1 : 0,
    }
    const equal =
      existing !== null &&
      existing !== undefined &&
      ['name', 'amount', 'currency', 'period', 'category_id', 'basis', 'is_active'].every(
        (key) => existing[key as keyof BudgetRow] === after[key as keyof BudgetRow]
      ) &&
      JSON.stringify(storedBudgetScope(existing)) === after.scope_json
    if (mode === 'create' && existing && !equal)
      return {
        success: false,
        reason: 'budget_id_conflict',
        message: 'Budget ID exists with a different definition; use upsert-budget.',
      }
    const changed = !equal
    const action = existing ? 'updated' : 'created'
    if (input.dryRun)
      return {
        success: true,
        dryRun: true,
        action,
        changed,
        wouldCreate: existing ? undefined : budgetSnapshot(after),
        wouldUpdate: existing
          ? {
              budgetId: existing.id,
              before: budgetSnapshot(existing),
              after: budgetSnapshot(after),
            }
          : undefined,
        message: `Dry run: budget "${after.name}" would be ${action}.`,
      }
    if (changed) {
      if (!existing)
        execute(
          `INSERT INTO budgets (id, name, amount, currency, period, category_id, scope_json, basis, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            after.id,
            after.name,
            after.amount,
            after.currency,
            after.period,
            after.category_id,
            after.scope_json,
            after.basis,
            after.is_active,
          ]
        )
      else
        execute(
          `UPDATE budgets SET name=$1, amount=$2, currency=$3, period=$4, category_id=$5, scope_json=$6, basis=$7, is_active=$8,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=$9`,
          [
            after.name,
            after.amount,
            after.currency,
            after.period,
            after.category_id,
            after.scope_json,
            after.basis,
            after.is_active,
            after.id,
          ]
        )
      writeAuditLog({
        entity: 'budget',
        entityId: after.id,
        action: existing ? 'update' : 'create',
        before: existing ? { budget: budgetSnapshot(existing) } : null,
        after: { budget: budgetSnapshot(after) },
      })
    }
    return {
      success: true,
      action: equal && mode === 'create' ? 'noop' : action,
      changed,
      matchedBy: input.budgetId
        ? 'budgetId'
        : existing
          ? category.id
            ? 'category'
            : 'name'
          : 'new',
      budget: budgetSnapshot(after),
      message: changed ? `${action} budget "${after.name}".` : `Budget "${after.name}" unchanged.`,
    }
  })
}
const createBudget: ToolDefinition = {
  name: 'create-budget',
  description: 'Create a scoped budget; optional budgetId makes identical replays a no-op.',
  schema: z.object({
    ...fields,
    amount: positiveMoneyAmount('Amount in the plan currency'),
    period: fields.period.default('monthly'),
  }),
  effects: { idempotent: false, writesTo: ['budgets', 'audit_log', 'app_data_state'] },
  execute: async (input) => saveBudget(input, 'create'),
}
const upsertBudget: ToolDefinition = {
  name: 'upsert-budget',
  description: 'Idempotently create or update a scoped budget.',
  schema: z.object(fields),
  effects: { idempotent: true, writesTo: ['budgets', 'audit_log', 'app_data_state'] },
  execute: async (input) => saveBudget(input, 'upsert'),
}
const getBudgetStatus: ToolDefinition = {
  name: 'get-budget-status',
  description: 'Inspect current-definition budget usage in inclusive resolved windows.',
  schema: z.object({
    categoryId: z.string().optional(),
    budgetId: z.string().optional(),
    includeInactive: z.boolean().optional().default(false),
    asOf: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    through: z.enum(['as_of', 'period_end']).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    timeZone: z.string().optional(),
    period: z.enum(['week', 'month', 'year', 'custom']).optional(),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) =>
    transaction(() => {
      const conditions = [
        input.budgetId ? 'b.id = $1' : input.includeInactive ? '1=1' : 'b.is_active = 1',
      ]
      const params: unknown[] = input.budgetId ? [input.budgetId] : []
      if (input.categoryId) {
        params.push(input.categoryId)
        conditions.push(`b.category_id = $${params.length}`)
      }
      const budgets = query<BudgetRow>(
        `${budgetSelect} WHERE ${conditions.join(' AND ')} ORDER BY b.name,b.id`,
        params
      )
      if (!budgets.length) return { success: true, budgets: [], message: 'No budgets found.' }
      const dataset = loadScopedDataset()
      const statuses = budgets.map((budget) => {
        const period =
          input.period ??
          ({ weekly: 'week', monthly: 'month', yearly: 'year' } as const)[budget.period]
        const window = {
          period,
          asOf: input.asOf,
          start: input.start,
          end: input.end,
          through: input.through,
          weekStartsOn: input.weekStartsOn,
          timeZone: input.timeZone,
        }
        let scope: unknown
        try {
          scope = storedBudgetScope(budget)
        } catch {
          scope = budget.scope_json
        }
        const result = scopedActual({
          dataset,
          scope,
          currency: budget.currency,
          basis: budget.basis,
          window,
          groupBy: 'category',
        })
        const comparison = budgetWindowComparability(result.window, budget.period)
        const spent = result.budgetUsage.amountCentavos
        const remaining =
          comparison.limitComparable && spent !== null ? budget.amount - spent : null
        const descriptor = {
          budgetId: budget.id,
          asOf: result.window.asOf,
          start: result.window.requested.start ?? result.window.periodStart,
          end: result.window.requested.end ?? result.window.periodEnd,
          through: result.window.through,
          weekStartsOn: result.window.weekStartsOn,
          timeZone: result.window.timeZone,
          period: result.window.period,
        }
        const mainCurrency = getCurrencySettings().mainCurrency
        const simpleScope =
          result.scope &&
          !result.scope.accountIds.length &&
          !result.scope.excludeAccountIds.length &&
          !result.scope.excludeCategoryIds.length &&
          !result.scope.tags.length &&
          !result.scope.excludeTags.length &&
          result.scope.categoryIds.length === (budget.category_id ? 1 : 0) &&
          (!budget.category_id || result.scope.categoryIds[0] === budget.category_id)
        const plan = readCurrentAmounts([
          { id: budget.id, amountCentavos: budget.amount, currency: budget.currency },
        ])
        const mainSpending =
          mainCurrency && simpleScope && budget.basis === 'gross_cashflow'
            ? scopedActual({
                dataset,
                scope: result.scope,
                currency: mainCurrency,
                basis: 'gross_cashflow',
                window,
                groupBy: 'none',
              })
            : null
        const mainComplete = Boolean(
          comparison.limitComparable && plan.complete && mainSpending?.budgetUsage.complete
        )
        return {
          ...budgetSnapshot({ ...budget, scope_json: JSON.stringify(result.scope ?? {}) }),
          categoryName:
            budget.category_name ??
            (result.scope?.categoryIds.length === 1 && result.scope.categoryIds[0] === null
              ? 'Uncategorized'
              : result.scope?.categoryIds.length
                ? null
                : 'All categories'),
          complete: result.budgetUsage.complete,
          budgetAmount: comparison.limitComparable ? fromCentavos(budget.amount) : null,
          spentAmount: spent === null ? null : fromCentavos(spent),
          knownSpentAmount: fromCentavos(result.budgetUsage.knownAmountCentavos ?? 0),
          remaining: remaining === null ? null : fromCentavos(remaining),
          percentUsed: remaining === null ? null : Math.round((spent! / budget.amount) * 100),
          isOverBudget: remaining === null ? null : remaining < 0,
          periodStart: result.window.start,
          periodEnd: result.window.end,
          window: result.window,
          comparison,
          definitionPolicy: result.definitionPolicy,
          mainComparison: {
            complete: mainComplete,
            policy: 'current_plan_today_vs_transaction_date_spending',
            toCurrency: plan.toCurrency,
            plan,
            spending: mainSpending
              ? { ...mainSpending, expenseCentavos: mainSpending.budgetUsage.amountCentavos }
              : null,
            remainingCentavos: mainComplete
              ? plan.totalCentavos! - mainSpending!.budgetUsage.amountCentavos!
              : null,
          },
          spending: result,
          scope: result.scope,
          basis: budget.basis,
          ...contributorInspection(result, descriptor),
        }
      })
      const single = statuses.length === 1 ? statuses[0] : null
      const additive = single && single.comparison.limitComparable
      const totalsByCurrency = [...new Set(statuses.map((row) => row.currency))]
        .sort()
        .map((currency) => ({
          currency,
          complete: Boolean(additive && single?.currency === currency && single.complete),
          totalBudget: additive && single?.currency === currency ? single.budgetAmount : null,
          totalSpent: additive && single?.currency === currency ? single.spentAmount : null,
          totalRemaining: additive && single?.currency === currency ? single.remaining : null,
          overallPercentUsed: additive && single?.currency === currency ? single.percentUsed : null,
          reason:
            statuses.length > 1
              ? 'independent_budgets_nonadditive'
              : (single?.comparison.reason ?? (single?.complete ? null : 'incomplete_usage')),
        }))
      return {
        success: statuses.every((row) => row.complete),
        complete: statuses.every((row) => row.complete),
        basis: single?.basis ?? null,
        currency: statuses.length === 1 ? (single?.currency ?? null) : null,
        budgets: statuses,
        totalsByCurrency,
        summary: {
          totalBudget: additive ? single.budgetAmount : null,
          totalSpent: additive ? single.spentAmount : null,
          totalRemaining: additive ? single.remaining : null,
          overallPercentUsed: additive ? single.percentUsed : null,
          reason:
            statuses.length > 1
              ? 'independent_budgets_nonadditive'
              : (single?.comparison.reason ?? null),
        },
        message: `${statuses.length} budget(s); independent limits are not additive.`,
      }
    }),
}
// ---------------------------------------------------------------------------
// 19. delete-budget
// ---------------------------------------------------------------------------

const deleteBudget: ToolDefinition = {
  name: 'delete-budget',
  effects: { writesTo: ['budgets', 'audit_log', 'budget_periods', 'app_data_state'] },
  description:
    'Delete a budget. Use this when the user wants to remove a budget they no longer need.',
  schema: z.object({
    budgetId: z.string().describe('The ID of the budget to delete'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the budget deletion without writing it'),
  }),
  execute: async ({ budgetId, dryRun }) => {
    const existing = await query<BudgetRow>(
      `SELECT b.id, b.name, b.amount, b.currency, b.period, b.category_id, b.is_active, c.name as category_name
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id
       WHERE b.id = $1`,
      [budgetId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Budget ${budgetId} not found.` }
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldDelete: {
          id: existing[0].id,
          name: existing[0].name,
        },
        message: `Dry run: budget "${existing[0].name}" would be deleted.`,
      }
    }

    transaction(() => {
      execute('DELETE FROM budgets WHERE id = $1', [budgetId])
      writeAuditLog({
        entity: 'budget',
        entityId: budgetId,
        action: 'delete',
        before: { budget: budgetSnapshot(existing[0]) },
        after: null,
      })
    })

    return {
      success: true,
      message: `Deleted budget "${existing[0].name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 20. get-net-worth
// ---------------------------------------------------------------------------

const getNetWorth: ToolDefinition = {
  name: 'get-net-worth',
  effects: { readOnly: true, writesTo: [] },
  description:
    'Calculate ownership-aware net worth. Returns native-currency components and only returns a converted total when ownership, verified prices, and FX are complete.',
  schema: z.object({}),
  execute: async () => {
    const valuation = readMainOwnershipValuation()
    const toAmount = (centavos: number | null) =>
      centavos === null ? null : fromCentavos(centavos)

    return {
      success: true,
      complete: valuation.complete,
      currency: valuation.targetCurrency,
      asOfDate: valuation.asOfDate,
      policy: valuation.policy,
      reason: valuation.reason,
      provenance: valuation.provenance,
      netWorth: toAmount(valuation.netWorthCentavos),
      totalAssets: toAmount(valuation.totalAssetsCentavos),
      totalLiabilities: toAmount(valuation.totalLiabilitiesCentavos),
      totalInvestments: toAmount(valuation.totalInvestmentsCentavos),
      nativeTotals: valuation.nativeTotals.map((total) => ({
        currency: total.currency,
        assets: fromCentavos(total.assetsCentavos),
        liabilities: fromCentavos(total.liabilitiesCentavos),
        netWorth: fromCentavos(total.netWorthCentavos),
        investments: fromCentavos(total.investmentsCentavos),
      })),
      missingCurrencies: valuation.missingCurrencies,
      unresolvedAccountIds: valuation.unresolvedAccountIds,
      incompleteHoldingIds: valuation.incompleteHoldingIds,
      accounts: valuation.accounts.map((account) => ({
        ...account,
        rawBalance: fromCentavos(account.rawBalanceCentavos),
        asset: fromCentavos(account.assetCentavos),
        liability: fromCentavos(account.liabilityCentavos),
      })),
      investments: valuation.holdings.map((holding) => ({
        id: holding.id,
        accountId: holding.accountId,
        quantityDecimal: holding.quantityDecimal,
        instrumentKey: holding.instrumentKey,
        value: toAmount(holding.valueCentavos),
        valueCurrency: holding.valueCurrency,
        convertedValue: toAmount(holding.convertedValueCentavos),
        costBasis: toAmount(holding.costBasisCentavos),
        costCurrency: holding.costCurrency,
        gainLoss: toAmount(holding.gainLossCentavos),
        included: holding.included,
        comparisonOnly: holding.comparisonOnly,
        complete: holding.complete,
        reasons: holding.reasons,
      })),
      message: valuation.complete
        ? `Net worth: ${valuation.targetCurrency} ${fromCentavos(valuation.netWorthCentavos ?? 0).toFixed(2)}.`
        : 'Net worth is incomplete. Resolve ownership, verified prices, or missing FX; native components are included.',
    }
  },
}

// ---------------------------------------------------------------------------
// 21. manage-investment
// ---------------------------------------------------------------------------

export const budgetsandnetworthTools: ToolDefinition[] = [
  createBudget,
  upsertBudget,
  getBudgetStatus,
  deleteBudget,
  getNetWorth,
]
