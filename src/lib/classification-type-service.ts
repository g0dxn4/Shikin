import {
  classificationCatalog,
  currentClassificationTypeRevision,
  normalizeClassificationTypeDraft,
  planConsumptionClassificationBatch,
  type ClassificationBatchPlan,
  type ClassificationBatchTarget,
  type ClassificationType,
  type ClassificationTypeDraft,
  type ClassificationTypeRevision,
} from '@shikin/finance-core'
import { importPlanToken } from '@shikin/finance-core/imports'
import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import {
  assertFrontendActivePaymentCapacity,
  auditFrontendCorrection,
  readFrontendConsumptionEvidence,
} from '@/lib/split-service'

export interface ClassificationTypeCatalog {
  definitions: ReturnType<typeof classificationCatalog>
  types: ClassificationType[]
  revisions: ClassificationTypeRevision[]
}

async function rows(tx: TransactionClient) {
  const [types, revisions] = await Promise.all([
    tx.query<ClassificationType>('SELECT * FROM classification_types ORDER BY created_at, id'),
    tx.query<ClassificationTypeRevision>(
      'SELECT * FROM classification_type_revisions ORDER BY type_id, version, id'
    ),
  ])
  return { types, revisions }
}

export function listClassificationTypes(
  includeArchived = false
): Promise<ClassificationTypeCatalog> {
  return withTransaction(async (tx) => {
    const value = await rows(tx)
    return {
      definitions: classificationCatalog(value.types, value.revisions, includeArchived),
      types: value.types.filter((type) => includeArchived || type.archived === 0),
      revisions: value.revisions,
    }
  })
}

async function auditType(
  tx: TransactionClient,
  typeId: string,
  action: string,
  before: unknown,
  after: unknown,
  note?: string
) {
  await tx.execute(
    `INSERT INTO audit_log
       (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
     VALUES (?, 'classification_type', ?, ?, ?, ?, 'frontend-classification-types', ?, ?)`,
    [
      generateId(),
      typeId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      note ?? null,
      new Date().toISOString(),
    ]
  )
}

export function createClassificationType(
  input: ClassificationTypeDraft & { auditNote?: string }
): Promise<{ type: ClassificationType; revision: ClassificationTypeRevision }> {
  return withTransaction(async (tx) => {
    const draft = normalizeClassificationTypeDraft(input)
    const timestamp = new Date().toISOString()
    const type: ClassificationType = {
      id: generateId(),
      current_revision_id: generateId(),
      archived: 0,
      created_at: timestamp,
      updated_at: timestamp,
    }
    const revision: ClassificationTypeRevision = {
      id: type.current_revision_id,
      type_id: type.id,
      version: 1,
      name: draft.name,
      financial_treatment: draft.financialTreatment,
      created_at: timestamp,
    }
    await tx.execute(
      'INSERT INTO classification_types (id, current_revision_id, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      [type.id, type.current_revision_id, timestamp, timestamp]
    )
    await tx.execute(
      'INSERT INTO classification_type_revisions (id, type_id, version, name, financial_treatment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        revision.id,
        revision.type_id,
        revision.version,
        revision.name,
        revision.financial_treatment,
        revision.created_at,
      ]
    )
    await auditType(
      tx,
      type.id,
      'create-classification-type',
      null,
      { type, revision },
      input.auditNote
    )
    return { type, revision }
  })
}

export function reviseClassificationType(input: {
  typeId: string
  expectedRevisionId: string
  name: string
  financialTreatment: ClassificationTypeDraft['financialTreatment']
  auditNote?: string
}): Promise<{ type: ClassificationType; revision: ClassificationTypeRevision; changed: boolean }> {
  return withTransaction(async (tx) => {
    const value = await rows(tx)
    const current = currentClassificationTypeRevision(
      input.typeId,
      input.expectedRevisionId,
      value.types,
      value.revisions
    )
    const draft = normalizeClassificationTypeDraft(input)
    if (
      current.revision.name === draft.name &&
      current.revision.financial_treatment === draft.financialTreatment
    )
      return { type: current.type, revision: current.revision, changed: false }
    const timestamp = new Date().toISOString()
    const revision: ClassificationTypeRevision = {
      id: generateId(),
      type_id: current.type.id,
      version:
        Math.max(
          ...value.revisions
            .filter((row) => row.type_id === current.type.id)
            .map((row) => row.version)
        ) + 1,
      name: draft.name,
      financial_treatment: draft.financialTreatment,
      created_at: timestamp,
    }
    await tx.execute(
      'INSERT INTO classification_type_revisions (id, type_id, version, name, financial_treatment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        revision.id,
        revision.type_id,
        revision.version,
        revision.name,
        revision.financial_treatment,
        revision.created_at,
      ]
    )
    const updated = await tx.execute(
      'UPDATE classification_types SET current_revision_id = ?, updated_at = ? WHERE id = ? AND current_revision_id = ? AND archived = 0',
      [revision.id, timestamp, current.type.id, current.revision.id]
    )
    if (updated.rowsAffected !== 1)
      throw new Error('Classification type changed. Refresh and retry.')
    const type = { ...current.type, current_revision_id: revision.id, updated_at: timestamp }
    await auditType(
      tx,
      type.id,
      'revise-classification-type',
      { type: current.type, revision: current.revision },
      { type, revision },
      input.auditNote
    )
    return { type, revision, changed: true }
  })
}

export function archiveClassificationType(input: {
  typeId: string
  expectedRevisionId: string
  auditNote?: string
}): Promise<{ type: ClassificationType; changed: boolean }> {
  return withTransaction(async (tx) => {
    const value = await rows(tx)
    const current = currentClassificationTypeRevision(
      input.typeId,
      input.expectedRevisionId,
      value.types,
      value.revisions,
      { allowArchived: true }
    )
    if (current.type.archived) return { type: current.type, changed: false }
    const timestamp = new Date().toISOString()
    const result = await tx.execute(
      'UPDATE classification_types SET archived = 1, updated_at = ? WHERE id = ? AND current_revision_id = ? AND archived = 0',
      [timestamp, current.type.id, current.revision.id]
    )
    if (result.rowsAffected !== 1)
      throw new Error('Classification type changed. Refresh and retry.')
    const type: ClassificationType = { ...current.type, archived: 1, updated_at: timestamp }
    await auditType(
      tx,
      type.id,
      'archive-classification-type',
      { type: current.type, revision: current.revision },
      { type, revision: current.revision },
      input.auditNote
    )
    return { type, changed: true }
  })
}

type State = { database_id: string; data_revision: number }
async function state(tx: TransactionClient): Promise<State> {
  const value = (
    await tx.query<State>('SELECT database_id, data_revision FROM app_data_state WHERE id = 1')
  )[0]
  if (!value?.database_id || !Number.isSafeInteger(value.data_revision))
    throw new Error('Classification preview requires database lineage and revision.')
  return value
}

async function protectedIds(tx: TransactionClient): Promise<string[]> {
  const values = await tx.query<{ id: string }>(
    `SELECT matched_transaction_id AS id FROM receivables WHERE matched_transaction_id IS NOT NULL
     UNION SELECT adjustment_transaction_id AS id FROM account_reconciliations WHERE adjustment_transaction_id IS NOT NULL`
  )
  return values.map((row) => row.id)
}

async function buildBatch(tx: TransactionClient, targets: readonly ClassificationBatchTarget[]) {
  const [evidence, catalogRows, protectedTransactionIds, currentState] = await Promise.all([
    readFrontendConsumptionEvidence(tx),
    rows(tx),
    protectedIds(tx),
    state(tx),
  ])
  const plan = planConsumptionClassificationBatch({
    evidence,
    types: catalogRows.types,
    revisions: catalogRows.revisions,
    targets,
    protectedTransactionIds,
  })
  if (plan.applicable) {
    for (const transactionId of new Set(
      plan.items.filter((item) => item.changed).map((item) => item.target.transactionId)
    )) {
      try {
        await assertFrontendActivePaymentCapacity(tx, transactionId, {
          classifications: plan.classifications,
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        for (const item of plan.items.filter(
          (entry) => entry.target.transactionId === transactionId
        ))
          item.errors.push(detail)
      }
    }
    plan.errors = [...new Set(plan.items.flatMap((item) => item.errors))]
    plan.applicable = plan.errors.length === 0
    plan.changed = plan.applicable && plan.items.some((item) => item.changed)
  }
  const token = importPlanToken({
    version: 1,
    namespace: 'shikin-consumption-classification-batch',
    databaseId: currentState.database_id,
    revision: currentState.data_revision,
    targets,
    plan,
  })
  return { evidence, plan, state: currentState, token }
}

export interface ConsumptionClassificationBatchPreview {
  revision: number
  previewToken: string
  applicable: boolean
  changed: boolean
  items: ClassificationBatchPlan['items']
  errors: string[]
  guidance: string
}

export function previewConsumptionClassifications(
  targets: readonly ClassificationBatchTarget[]
): Promise<ConsumptionClassificationBatchPreview> {
  return withTransaction(async (tx) => {
    const result = await buildBatch(tx, targets)
    return {
      revision: result.state.data_revision,
      previewToken: result.token,
      applicable: result.plan.applicable,
      changed: result.plan.changed,
      items: result.plan.items,
      errors: result.plan.errors,
      guidance: result.plan.guidance,
    }
  })
}

export function applyConsumptionClassifications(input: {
  targets: readonly ClassificationBatchTarget[]
  previewToken: string
  auditNote?: string
}): Promise<ConsumptionClassificationBatchPreview & { batchId: string | null }> {
  return withTransaction(async (tx) => {
    const result = await buildBatch(tx, input.targets)
    if (!result.plan.applicable)
      throw new Error(`Classification batch is invalid: ${result.plan.errors.join('; ')}`)
    if (!input.previewToken || input.previewToken !== result.token)
      throw new Error('Classification preview is stale. Refresh and review the complete batch.')
    const response = {
      revision: result.state.data_revision,
      previewToken: result.token,
      applicable: result.plan.applicable,
      changed: result.plan.changed,
      items: result.plan.items,
      errors: result.plan.errors,
      guidance: result.plan.guidance,
    }
    if (!result.plan.changed) return { ...response, batchId: null }
    const batchId = generateId()
    const final = result.plan.classifications.map((classification) =>
      classification.id.startsWith('__new__:')
        ? { ...classification, id: generateId() }
        : classification
    )
    for (const transactionId of new Set(
      result.plan.items.filter((item) => item.changed).map((item) => item.target.transactionId)
    ))
      await assertFrontendActivePaymentCapacity(tx, transactionId, { classifications: final })
    const appliedItems = result.plan.items.map((item) => ({
      ...item,
      after:
        final.find(
          (entry) =>
            entry.transaction_id === item.target.transactionId &&
            entry.split_id === item.target.splitId
        ) ?? item.after,
    }))
    for (const item of result.plan.items.filter((entry) => entry.changed)) {
      const after = final.find(
        (entry) =>
          entry.transaction_id === item.target.transactionId &&
          entry.split_id === item.target.splitId
      )!
      await tx.execute(
        `INSERT INTO transaction_consumption_classifications
           (id, transaction_id, split_id, role, referenced_purchase_id, type_revision_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET role=excluded.role,
           referenced_purchase_id=excluded.referenced_purchase_id,
           type_revision_id=excluded.type_revision_id,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        [
          after.id,
          after.transaction_id,
          after.split_id,
          after.role,
          after.referenced_purchase_id,
          after.type_revision_id,
        ]
      )
      await auditFrontendCorrection(
        tx,
        after.transaction_id,
        'batch-classify-consumption',
        { classification: item.before, batchId },
        { classification: after, batchId },
        'frontend-consumption-classification-batch',
        input.auditNote
      )
    }
    return { ...response, items: appliedItems, batchId }
  })
}
