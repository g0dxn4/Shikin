import {
  classificationContribution,
  financialTreatment,
  financialTreatments,
  resolveClassificationTypeRevision,
  validateClassificationTypeRevision,
  type ClassificationContribution,
  type ClassificationType,
  type ClassificationTypeRevision,
  type ConsumptionRole,
} from './classification-policy.js'
import {
  owningAllocation,
  validateConsumptionEvidence,
  type ConsumptionClassification,
  type ConsumptionEvidence,
} from './corrections.js'

export interface ClassificationCatalogEntry {
  kind: 'builtin' | 'custom'
  id: string
  revisionId: string | null
  version: number | null
  name: string
  role: ConsumptionRole
  archived: boolean
  direction: 'income' | 'expense'
  requiresPurchase: boolean
  contribution: ClassificationContribution
  guidance: string
}

/** Fixed definitions plus custom current heads. Historical revisions are returned separately by adapters. */
export function classificationCatalog(
  types: readonly ClassificationType[],
  revisions: readonly ClassificationTypeRevision[],
  includeArchived = false
): ClassificationCatalogEntry[] {
  const builtins = financialTreatments.map((definition) => ({
    kind: 'builtin' as const,
    id: definition.role,
    revisionId: null,
    version: null,
    name: definition.role,
    role: definition.role,
    archived: false,
    direction: definition.direction,
    requiresPurchase: definition.requiresPurchase,
    contribution: classificationContribution(definition.role, 1),
    guidance: definition.guidance,
  }))
  const custom = types
    .filter((type) => includeArchived || type.archived === 0)
    .map((type) => {
      const matches = revisions.filter(
        (revision) => revision.type_id === type.id && revision.id === type.current_revision_id
      )
      if (matches.length !== 1)
        throw new Error('Classification type current revision is missing or ambiguous.')
      const revision = matches[0]!
      validateClassificationTypeRevision(revision)
      const definition = financialTreatment(revision.financial_treatment)
      return {
        kind: 'custom' as const,
        id: type.id,
        revisionId: revision.id,
        version: revision.version,
        name: revision.name,
        role: revision.financial_treatment,
        archived: type.archived === 1,
        direction: definition.direction,
        requiresPurchase: definition.requiresPurchase,
        contribution: classificationContribution(revision.financial_treatment, 1),
        guidance: definition.guidance,
      }
    })
  return [...builtins, ...custom].sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      : a.kind === 'builtin'
        ? -1
        : 1
  )
}

export interface ClassificationTypeDraft {
  name: string
  financialTreatment: ConsumptionRole
}

export function normalizeClassificationTypeDraft(
  input: ClassificationTypeDraft
): ClassificationTypeDraft {
  const name = input.name.trim()
  if (!name || name.length > 100)
    throw new Error('Classification type name must be 1 to 100 characters.')
  financialTreatment(input.financialTreatment)
  return { name, financialTreatment: input.financialTreatment }
}

export function currentClassificationTypeRevision(
  typeId: string,
  expectedRevisionId: string,
  types: readonly ClassificationType[],
  revisions: readonly ClassificationTypeRevision[],
  options: { allowArchived?: boolean } = {}
): { type: ClassificationType; revision: ClassificationTypeRevision } {
  const matches = types.filter((entry) => entry.id === typeId)
  if (matches.length !== 1) throw new Error('Classification type is missing or ambiguous.')
  const type = matches[0]!
  if (!options.allowArchived && type.archived)
    throw new Error('Archived classification types cannot be selected or revised.')
  if (!expectedRevisionId || type.current_revision_id !== expectedRevisionId)
    throw new Error('Classification type changed. Refresh and use its current revision.')
  const revisionMatches = revisions.filter(
    (entry) => entry.type_id === type.id && entry.id === expectedRevisionId
  )
  if (revisionMatches.length !== 1)
    throw new Error('Classification type current revision is missing or ambiguous.')
  validateClassificationTypeRevision(revisionMatches[0]!)
  return { type, revision: revisionMatches[0]! }
}

export type ClassificationBatchSelection =
  | { builtinRole: ConsumptionRole; customTypeId?: never; expectedRevisionId?: never }
  | { builtinRole?: never; customTypeId: string; expectedRevisionId: string }

export type ClassificationBatchTarget = ClassificationBatchSelection & {
  transactionId: string
  splitId?: string | null
  referencedPurchaseId?: string | null
}

export interface ClassificationBatchItemPlan {
  target: { transactionId: string; splitId: string | null }
  before: ConsumptionClassification | null
  after: ConsumptionClassification | null
  resolved: {
    role: ConsumptionRole
    typeId: string | null
    revisionId: string | null
    version: number | null
    name: string
    contribution: ClassificationContribution
  } | null
  amountCentavos: number | null
  errors: string[]
  changed: boolean
}

export interface ClassificationBatchPlan {
  applicable: boolean
  changed: boolean
  items: ClassificationBatchItemPlan[]
  classifications: readonly ConsumptionClassification[]
  errors: string[]
  guidance: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function targetKey(target: { transactionId: string; splitId?: string | null }): string {
  return JSON.stringify([target.transactionId, target.splitId ?? null])
}

/**
 * Pure, order-independent final-state planner. New assignment IDs are private placeholders which
 * adapters MUST replace at apply time; references may only point at purchases already in evidence.
 */
export function planConsumptionClassificationBatch(input: {
  evidence: ConsumptionEvidence
  types: readonly ClassificationType[]
  revisions: readonly ClassificationTypeRevision[]
  targets: readonly ClassificationBatchTarget[]
  protectedTransactionIds?: readonly string[]
}): ClassificationBatchPlan {
  if (input.targets.length < 1 || input.targets.length > 100)
    throw new Error('Classification batch requires 1 to 100 allocation targets.')
  const duplicateKeys = new Set<string>()
  const seen = new Set<string>()
  for (const target of input.targets) {
    const key = targetKey(target)
    if (seen.has(key)) duplicateKeys.add(key)
    seen.add(key)
  }
  const protectedIds = new Set(input.protectedTransactionIds ?? [])
  const items: ClassificationBatchItemPlan[] = []
  const replacements = new Map<string, ConsumptionClassification>()
  for (const target of input.targets) {
    const splitId = target.splitId ?? null
    const key = targetKey(target)
    const before =
      input.evidence.classifications.find(
        (entry) => entry.transaction_id === target.transactionId && entry.split_id === splitId
      ) ?? null
    const errors: string[] = []
    if (!target.transactionId.trim()) errors.push('Transaction ID is required.')
    if (duplicateKeys.has(key)) errors.push('Duplicate allocation target in batch.')
    if (protectedIds.has(target.transactionId))
      errors.push(
        'Protected receivable or reconciliation evidence requires its dedicated workflow.'
      )
    const hasBuiltin = 'builtinRole' in target && target.builtinRole !== undefined
    const hasCustom = 'customTypeId' in target && Boolean(target.customTypeId)
    if (hasBuiltin === hasCustom)
      errors.push('Choose exactly one builtin role or custom classification type.')
    let role: ConsumptionRole | null = null
    let revision: ClassificationTypeRevision | null = null
    let typeId: string | null = null
    try {
      if (hasBuiltin) {
        role = target.builtinRole!
        financialTreatment(role)
      } else if (hasCustom) {
        const current = currentClassificationTypeRevision(
          target.customTypeId!,
          target.expectedRevisionId!,
          input.types,
          input.revisions
        )
        role = current.revision.financial_treatment
        revision = current.revision
        typeId = current.type.id
      }
    } catch (error) {
      errors.push(message(error))
    }
    let after: ConsumptionClassification | null = null
    let amountCentavos: number | null = null
    if (role) {
      after = {
        id: before?.id ?? `__new__:${key}`,
        transaction_id: target.transactionId,
        split_id: splitId,
        role,
        referenced_purchase_id: target.referencedPurchaseId ?? null,
        type_revision_id: revision?.id ?? null,
      }
      try {
        const owner = owningAllocation(after, {
          ...input.evidence,
          typeRevisions: input.revisions,
          classifications: before
            ? input.evidence.classifications.map((entry) =>
                entry.id === before.id ? after! : entry
              )
            : [...input.evidence.classifications, after],
        })
        amountCentavos = owner.amount
      } catch (error) {
        errors.push(message(error))
      }
      if (after.referenced_purchase_id) {
        const existingReference = input.evidence.classifications.find(
          (entry) => entry.id === after!.referenced_purchase_id
        )
        if (!existingReference || existingReference.role !== 'purchase')
          errors.push('References must identify an existing confirmed purchase classification.')
        else {
          try {
            owningAllocation(existingReference, {
              ...input.evidence,
              typeRevisions: input.revisions,
            })
          } catch (error) {
            errors.push(`Referenced purchase is invalid: ${message(error)}`)
          }
        }
      }
      replacements.set(key, after)
    }
    const resolved = role
      ? {
          role,
          typeId,
          revisionId: revision?.id ?? null,
          version: revision?.version ?? null,
          name: revision?.name ?? role,
          contribution: classificationContribution(role, amountCentavos ?? 0),
        }
      : null
    const changed = Boolean(
      after &&
      (!before ||
        before.role !== after.role ||
        before.referenced_purchase_id !== after.referenced_purchase_id ||
        (before.type_revision_id ?? null) !== (after.type_revision_id ?? null))
    )
    items.push({
      target: { transactionId: target.transactionId, splitId },
      before,
      after,
      resolved,
      amountCentavos,
      errors,
      changed,
    })
  }
  const classifications = input.evidence.classifications
    .filter(
      (entry) =>
        !replacements.has(
          targetKey({ transactionId: entry.transaction_id, splitId: entry.split_id })
        )
    )
    .concat([...replacements.values()])
  if (items.every((item) => item.errors.length === 0)) {
    try {
      validateConsumptionEvidence({
        ...input.evidence,
        typeRevisions: input.revisions,
        classifications,
      })
    } catch (error) {
      const detail = message(error)
      for (const item of items) item.errors.push(detail)
    }
  }
  const errors = [...new Set(items.flatMap((item) => item.errors))]
  const applicable = errors.length === 0
  return {
    applicable,
    changed: applicable && items.some((item) => item.changed),
    items,
    classifications,
    errors,
    guidance:
      'Classification changes reporting treatment only. It does not alter amounts, balances, dates, categories, status, source/import evidence, duplicate decisions, holdings, receivables, or review approval.',
  }
}

export function historicalClassificationLabel(
  assignment: ConsumptionClassification,
  revisions: readonly ClassificationTypeRevision[]
): { name: string; version: number | null; revisionId: string | null } {
  const revision = resolveClassificationTypeRevision(assignment, revisions)
  return revision
    ? { name: revision.name, version: revision.version, revisionId: revision.id }
    : { name: assignment.role, version: null, revisionId: null }
}
