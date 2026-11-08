import { assertFxCurrency } from './fx.js'
import { inspectReportScope, resolveBudgetScope, type ReportScope } from './report-scope.js'

/** The existing CLI major-unit input bound, also enforced after centavo conversion. */
export const MAX_BUDGET_AMOUNT = 1_000_000_000

export interface BudgetDefinition {
  name: string
  amount: number
  currency: string
  period: 'weekly' | 'monthly' | 'yearly'
  basis: 'gross_cashflow' | 'net_consumption'
  category_id: string | null
  scope_json: string
  is_active: number
}
export type StoredBudgetDefinition = Omit<BudgetDefinition, 'currency' | 'basis' | 'scope_json'> &
  Partial<Pick<BudgetDefinition, 'currency' | 'basis' | 'scope_json'>>
export interface BudgetDefinitionPatch {
  name?: string
  amountCentavos?: number
  /** Original boundary input: enforce the CLI maximum before centavo rounding. */
  amount?: number
  currency?: string
  period?: BudgetDefinition['period']
  basis?: BudgetDefinition['basis']
  categoryId?: string | null
  scope?: ReportScope
  isActive?: boolean
  expectedMainCurrency?: string
}
export class BudgetDefinitionError extends Error {
  constructor(
    public readonly reason:
      | 'main_currency_unconfigured'
      | 'amount_required_for_currency_change'
      | 'amount_required',
    message: string
  ) {
    super(message)
    this.name = 'BudgetDefinitionError'
  }
}

/** Resolve a sparse mutation without canonicalizing any omitted stored bytes. */
export function resolveBudgetDefinition(input: {
  stored?: StoredBudgetDefinition
  patch: BudgetDefinitionPatch
  mainCurrency: string | null
  references: { accounts: readonly { id: string }[]; categories: readonly { id: string }[] }
}): BudgetDefinition {
  const { stored, patch, mainCurrency, references } = input
  // Settings are authoritative even when this mutation uses an explicit/stored currency.
  if (mainCurrency !== null) assertFxCurrency(mainCurrency)
  if (patch.expectedMainCurrency !== undefined && patch.expectedMainCurrency !== mainCurrency)
    throw new Error(
      'Main currency changed while this budget form was open. Review the amount and try again.'
    )
  const currency = patch.currency?.trim().toUpperCase() ?? stored?.currency ?? mainCurrency
  if (!currency)
    throw new BudgetDefinitionError(
      'main_currency_unconfigured',
      'Configure a database main currency before creating a budget.'
    )
  assertFxCurrency(currency.trim().toUpperCase())
  if (
    stored &&
    patch.currency !== undefined &&
    currency !== stored.currency?.trim().toUpperCase() &&
    patch.amountCentavos === undefined
  )
    throw new BudgetDefinitionError(
      'amount_required_for_currency_change',
      'Re-enter the amount when changing budget currency. No automatic conversion is performed.'
    )

  const resolved = resolveBudgetScope({
    ...(stored
      ? {
          storedScope:
            patch.scope === undefined ? JSON.parse(stored.scope_json ?? '{}') : undefined,
          storedCategoryId: stored.category_id,
        }
      : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
  })
  const inspected = inspectReportScope(resolved.scope, references)
  if (inspected.issues.length)
    throw new Error(inspected.issues.map((issue) => issue.message).join('; '))

  const amount = patch.amountCentavos ?? stored?.amount
  if (amount === undefined)
    throw new BudgetDefinitionError('amount_required', 'A positive budget amount is required.')
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error('A positive budget amount is required.')
  if (
    amount > MAX_BUDGET_AMOUNT * 100 ||
    (patch.amount !== undefined && patch.amount > MAX_BUDGET_AMOUNT)
  )
    throw new Error('Budget amount exceeds the supported maximum.')
  const name = patch.name === undefined ? (stored?.name ?? '') : patch.name.trim()
  if (!name.trim()) throw new Error('A budget name is required.')
  const period = patch.period ?? (stored ? stored.period : 'monthly')
  if (!['weekly', 'monthly', 'yearly'].includes(period)) throw new Error('Invalid budget period.')
  const basis = patch.basis ?? (stored?.basis === undefined ? 'gross_cashflow' : stored.basis)
  if (!['gross_cashflow', 'net_consumption'].includes(basis))
    throw new Error('Invalid budget basis.')

  let scopeJson = JSON.stringify(resolved.scope)
  if (stored) {
    try {
      const before = resolveBudgetScope({
        storedScope: JSON.parse(stored.scope_json ?? '{}'),
        storedCategoryId: stored.category_id,
      })
      if (stored.scope_json !== undefined && JSON.stringify(before.scope) === scopeJson)
        scopeJson = stored.scope_json
    } catch {
      // Only an explicit replacement reaches here for malformed stored scope.
    }
  }
  return {
    name,
    amount,
    currency,
    period,
    basis,
    category_id:
      stored && scopeJson === stored.scope_json ? stored.category_id : resolved.categoryId,
    scope_json: scopeJson,
    is_active:
      patch.isActive === undefined ? (stored ? stored.is_active : 1) : Number(patch.isActive),
  }
}
