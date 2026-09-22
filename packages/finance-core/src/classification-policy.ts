/** Fixed reporting treatments. Classification never changes gross cashflow or ledger values. */
export const consumptionRoles = [
  'purchase',
  'fee',
  'earned_income',
  'refund',
  'internal_inflow',
  'cash_withdrawal',
  'principal',
  'other_income',
  'principal_recovery',
  'asset_acquisition',
] as const
export type ConsumptionRole = (typeof consumptionRoles)[number]

export interface ClassificationContribution {
  consumptionCentavos: number
  earnedIncomeCentavos: number
  otherIncomeCentavos: number
  principalRecoveryCentavos: number
  assetAcquisitionCentavos: number
}
export interface FinancialTreatmentDefinition {
  readonly role: ConsumptionRole
  readonly direction: 'income' | 'expense'
  readonly requiresPurchase: boolean
  readonly contributionField: keyof ClassificationContribution | null
  readonly contributionSign: 1 | -1
  readonly guidance: string
}
export const financialTreatments: readonly FinancialTreatmentDefinition[] = Object.freeze(
  (
    [
      {
        role: 'purchase',
        direction: 'expense',
        requiresPurchase: false,
        contributionField: 'consumptionCentavos',
        contributionSign: 1,
        guidance: 'Ordinary consumption purchase.',
      },
      {
        role: 'fee',
        direction: 'expense',
        requiresPurchase: false,
        contributionField: 'consumptionCentavos',
        contributionSign: 1,
        guidance: 'Consumption fee.',
      },
      {
        role: 'earned_income',
        direction: 'income',
        requiresPurchase: false,
        contributionField: 'earnedIncomeCentavos',
        contributionSign: 1,
        guidance: 'Explicit earned income.',
      },
      {
        role: 'refund',
        direction: 'income',
        requiresPurchase: true,
        contributionField: 'consumptionCentavos',
        contributionSign: -1,
        guidance:
          'Requires a confirmed same-currency purchase; attributed to its category at refund date.',
      },
      {
        role: 'internal_inflow',
        direction: 'income',
        requiresPurchase: false,
        contributionField: null,
        contributionSign: 1,
        guidance: 'Internal inflow, not earned income.',
      },
      {
        role: 'cash_withdrawal',
        direction: 'expense',
        requiresPurchase: false,
        contributionField: null,
        contributionSign: 1,
        guidance: 'Withdrawal, not consumption.',
      },
      {
        role: 'principal',
        direction: 'expense',
        requiresPurchase: true,
        contributionField: null,
        contributionSign: 1,
        guidance:
          'Expense principal requires a same-currency purchase; not incoming loan recovery.',
      },
      {
        role: 'other_income',
        direction: 'income',
        requiresPurchase: false,
        contributionField: 'otherIncomeCentavos',
        contributionSign: 1,
        guidance: 'User-confirmed non-earned cash receipt; no gain or interest inferred.',
      },
      {
        role: 'principal_recovery',
        direction: 'income',
        requiresPurchase: false,
        contributionField: 'principalRecoveryCentavos',
        contributionSign: 1,
        guidance:
          'Untracked loan principal received. Use Receivables for tracked payments; creates no receivable or interest.',
      },
      {
        role: 'asset_acquisition',
        direction: 'expense',
        requiresPurchase: false,
        contributionField: 'assetAcquisitionCentavos',
        contributionSign: 1,
        guidance:
          'Excluded from consumption; creates no holding or net worth value. Manage investments independently.',
      },
    ] satisfies FinancialTreatmentDefinition[]
  ).map((definition) => Object.freeze(definition))
)

export function financialTreatment(role: ConsumptionRole): FinancialTreatmentDefinition {
  const definition = financialTreatments.find((entry) => entry.role === role)
  if (!definition) throw new Error('Unknown financial treatment.')
  return definition
}

/** Use after any per-parent FX conversion/apportionment. Zero converted allocations are valid. */
export function classificationContribution(
  role: ConsumptionRole,
  amountCentavos: number
): ClassificationContribution {
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos < 0)
    throw new Error('Contribution amount must be non-negative safe centavos.')
  const definition = financialTreatment(role)
  const result: ClassificationContribution = {
    consumptionCentavos: 0,
    earnedIncomeCentavos: 0,
    otherIncomeCentavos: 0,
    principalRecoveryCentavos: 0,
    assetAcquisitionCentavos: 0,
  }
  if (definition.contributionField)
    result[definition.contributionField] =
      amountCentavos === 0 ? 0 : definition.contributionSign * amountCentavos
  return result
}

export interface ClassificationType {
  readonly id: string
  readonly current_revision_id: string
  readonly archived: 0 | 1
  readonly created_at: string
  readonly updated_at: string
}
export interface ClassificationTypeRevision {
  readonly id: string
  readonly type_id: string
  readonly version: number
  readonly name: string
  readonly financial_treatment: ConsumptionRole
  readonly created_at: string
}

export function validateClassificationTypeRevision(revision: ClassificationTypeRevision): void {
  if (
    !revision.id ||
    !revision.type_id ||
    !Number.isSafeInteger(revision.version) ||
    revision.version < 1 ||
    !revision.name.trim() ||
    revision.name !== revision.name.trim() ||
    revision.name.length > 100 ||
    !revision.created_at
  )
    throw new Error('Invalid classification type revision.')
  financialTreatment(revision.financial_treatment)
}

/** Historical resolution uses ONLY the pinned revision, never a type's current head or archive flag. */
export function resolveClassificationTypeRevision(
  assignment: { role: ConsumptionRole; type_revision_id?: string | null },
  revisions: readonly ClassificationTypeRevision[] = []
): ClassificationTypeRevision | null {
  if (assignment.type_revision_id === undefined || assignment.type_revision_id === null) return null
  const matches = revisions.filter((revision) => revision.id === assignment.type_revision_id)
  if (matches.length !== 1)
    throw new Error('Pinned classification type revision is missing or ambiguous.')
  const revision = matches[0]!
  validateClassificationTypeRevision(revision)
  if (revision.financial_treatment !== assignment.role)
    throw new Error('Classification role must match its pinned type revision treatment.')
  return revision
}
