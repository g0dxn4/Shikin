import {
  classificationCatalog,
  consumptionRoles,
  currentClassificationTypeRevision,
  materializeClassificationBatchPlan,
  normalizeClassificationTypeDraft,
  planConsumptionClassificationBatch,
  type ClassificationBatchTarget,
  type ClassificationType,
  type ClassificationTypeRevision,
  type ConsumptionRole,
} from '@shikin/finance-core'
import { importPlanToken } from '@shikin/finance-core/imports'
import { assertActivePaymentCapacity } from './payment-links.js'
import { readConsumptionEvidence } from './transaction-corrections.js'
import {
  execute,
  generateId,
  query,
  transaction,
  writeAuditLog,
  z,
  type ToolDefinition,
} from './tools/shared.js'

function readTypes() {
  return {
    types: query<ClassificationType>('SELECT * FROM classification_types ORDER BY created_at, id'),
    revisions: query<ClassificationTypeRevision>(
      'SELECT * FROM classification_type_revisions ORDER BY type_id, version, id'
    ),
  }
}

export function listClassificationTypesService(includeArchived = false) {
  const rows = readTypes()
  return {
    definitions: classificationCatalog(rows.types, rows.revisions, includeArchived),
    types: rows.types.filter((type) => includeArchived || type.archived === 0),
    revisions: rows.revisions,
    guidance: {
      economicEffects:
        'Every builtin or custom type maps to one fixed treatment. Classification never changes gross cashflow, balances, transaction fields, or approval state.',
      references:
        'Refund and expense principal require an existing confirmed same-currency purchase classification and independent caps.',
      workflows:
        'Use Receivables for tracked repayments; principal_recovery only labels legacy/untracked receipts. Asset acquisition creates no holding; manage investments independently. Card repayment evidence remains separately confirmed.',
    },
  }
}

export function createClassificationTypeService(input: {
  name: string
  financialTreatment: ConsumptionRole
  auditSource?: string
  auditNote?: string
}) {
  return transaction(() => {
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
    execute(
      'INSERT INTO classification_types (id,current_revision_id,archived,created_at,updated_at) VALUES ($1,$2,0,$3,$4)',
      [type.id, type.current_revision_id, timestamp, timestamp]
    )
    execute(
      'INSERT INTO classification_type_revisions (id,type_id,version,name,financial_treatment,created_at) VALUES ($1,$2,1,$3,$4,$5)',
      [
        revision.id,
        revision.type_id,
        revision.name,
        revision.financial_treatment,
        revision.created_at,
      ]
    )
    writeAuditLog({
      entity: 'classification_type',
      entityId: type.id,
      action: 'create',
      before: null,
      after: { type, revision },
      source: input.auditSource ?? 'create-classification-type',
      note: input.auditNote,
    })
    return { success: true, type, revision }
  })
}

export function reviseClassificationTypeService(input: {
  typeId: string
  expectedRevisionId: string
  name: string
  financialTreatment: ConsumptionRole
  auditSource?: string
  auditNote?: string
}) {
  return transaction(() => {
    const rows = readTypes()
    const current = currentClassificationTypeRevision(
      input.typeId,
      input.expectedRevisionId,
      rows.types,
      rows.revisions
    )
    const draft = normalizeClassificationTypeDraft(input)
    if (
      draft.name === current.revision.name &&
      draft.financialTreatment === current.revision.financial_treatment
    )
      return { success: true, type: current.type, revision: current.revision, changed: false }
    const timestamp = new Date().toISOString()
    const revision: ClassificationTypeRevision = {
      id: generateId(),
      type_id: current.type.id,
      version:
        Math.max(
          ...rows.revisions
            .filter((revision) => revision.type_id === current.type.id)
            .map((revision) => revision.version)
        ) + 1,
      name: draft.name,
      financial_treatment: draft.financialTreatment,
      created_at: timestamp,
    }
    execute(
      'INSERT INTO classification_type_revisions (id,type_id,version,name,financial_treatment,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        revision.id,
        revision.type_id,
        revision.version,
        revision.name,
        revision.financial_treatment,
        timestamp,
      ]
    )
    const updated = execute(
      'UPDATE classification_types SET current_revision_id=$1,updated_at=$2 WHERE id=$3 AND current_revision_id=$4 AND archived=0',
      [revision.id, timestamp, current.type.id, current.revision.id]
    )
    if (updated.rowsAffected !== 1)
      throw new Error('Classification type changed. Refresh and retry.')
    const type: ClassificationType = {
      ...current.type,
      current_revision_id: revision.id,
      updated_at: timestamp,
    }
    writeAuditLog({
      entity: 'classification_type',
      entityId: type.id,
      action: 'revise',
      before: { type: current.type, revision: current.revision },
      after: { type, revision },
      source: input.auditSource ?? 'revise-classification-type',
      note: input.auditNote,
    })
    return { success: true, type, revision, changed: true }
  })
}

export function archiveClassificationTypeService(input: {
  typeId: string
  expectedRevisionId: string
  auditSource?: string
  auditNote?: string
}) {
  return transaction(() => {
    const rows = readTypes()
    const current = currentClassificationTypeRevision(
      input.typeId,
      input.expectedRevisionId,
      rows.types,
      rows.revisions,
      { allowArchived: true }
    )
    if (current.type.archived)
      return { success: true, type: current.type, revision: current.revision, changed: false }
    const timestamp = new Date().toISOString()
    const result = execute(
      'UPDATE classification_types SET archived=1,updated_at=$1 WHERE id=$2 AND current_revision_id=$3 AND archived=0',
      [timestamp, current.type.id, current.revision.id]
    )
    if (result.rowsAffected !== 1)
      throw new Error('Classification type changed. Refresh and retry.')
    const type: ClassificationType = { ...current.type, archived: 1, updated_at: timestamp }
    writeAuditLog({
      entity: 'classification_type',
      entityId: type.id,
      action: 'archive',
      before: { type: current.type, revision: current.revision },
      after: { type, revision: current.revision },
      source: input.auditSource ?? 'archive-classification-type',
      note: input.auditNote,
    })
    return { success: true, type, revision: current.revision, changed: true }
  })
}

type DataState = { database_id: string; data_revision: number }
function currentState(): DataState {
  const state = query<DataState>(
    'SELECT database_id,data_revision FROM app_data_state WHERE id=1'
  )[0]
  if (!state?.database_id || !Number.isSafeInteger(state.data_revision))
    throw new Error('Classification preview requires database lineage and revision.')
  return state
}
function protectedTransactionIds(): string[] {
  return query<{ id: string }>(
    `SELECT matched_transaction_id AS id FROM receivables WHERE matched_transaction_id IS NOT NULL
     UNION SELECT adjustment_transaction_id AS id FROM account_reconciliations WHERE adjustment_transaction_id IS NOT NULL`
  ).map((row) => row.id)
}
function buildBatch(targets: readonly ClassificationBatchTarget[]) {
  const evidence = readConsumptionEvidence()
  const rows = readTypes()
  const state = currentState()
  const plan = planConsumptionClassificationBatch({
    evidence,
    types: rows.types,
    revisions: rows.revisions,
    targets,
    protectedTransactionIds: protectedTransactionIds(),
  })
  if (plan.applicable) {
    for (const transactionId of new Set(
      plan.items.filter((item) => item.changed).map((item) => item.target.transactionId)
    )) {
      try {
        assertActivePaymentCapacity({ transactionId, classifications: plan.classifications })
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
  const previewToken = importPlanToken({
    version: 1,
    namespace: 'shikin-consumption-classification-batch',
    databaseId: state.database_id,
    revision: state.data_revision,
    targets,
    plan,
  })
  return { evidence, state, plan, previewToken }
}
export function previewConsumptionClassificationsService(
  targets: readonly ClassificationBatchTarget[]
) {
  const result = buildBatch(targets)
  return {
    success: true,
    revision: result.state.data_revision,
    previewToken: result.previewToken,
    applicable: result.plan.applicable,
    changed: result.plan.changed,
    items: result.plan.items,
    errors: result.plan.errors,
    guidance: result.plan.guidance,
  }
}
export function applyConsumptionClassificationsService(input: {
  targets: readonly ClassificationBatchTarget[]
  previewToken: string
  auditSource?: string
  auditNote?: string
}) {
  return transaction(() => {
    const result = buildBatch(input.targets)
    if (!result.plan.applicable)
      throw new Error(`Classification batch is invalid: ${result.plan.errors.join('; ')}`)
    if (!input.previewToken || input.previewToken !== result.previewToken)
      throw new Error('Classification preview is stale. Refresh and review the complete batch.')
    if (!result.plan.changed)
      return { ...previewConsumptionClassificationsService(input.targets), batchId: null }
    const batchId = generateId()
    const materialized = materializeClassificationBatchPlan(result.plan, generateId)
    const final = materialized.classifications
    for (const transactionId of new Set(
      result.plan.items.filter((item) => item.changed).map((item) => item.target.transactionId)
    ))
      assertActivePaymentCapacity({ transactionId, classifications: final })
    const appliedItems = materialized.items
    for (const item of result.plan.items.filter((entry) => entry.changed)) {
      const after = final.find(
        (entry) =>
          entry.transaction_id === item.target.transactionId &&
          entry.split_id === item.target.splitId
      )!
      execute(
        `INSERT INTO transaction_consumption_classifications
           (id,transaction_id,split_id,role,referenced_purchase_id,type_revision_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET role=excluded.role,
           referenced_purchase_id=excluded.referenced_purchase_id,
           type_revision_id=excluded.type_revision_id,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        [
          after.id,
          after.transaction_id,
          after.split_id,
          after.role,
          after.referenced_purchase_id,
          after.type_revision_id,
        ]
      )
      writeAuditLog({
        entity: 'transaction',
        entityId: after.transaction_id,
        action: 'batch-classify-consumption',
        before: { classification: item.before, batchId },
        after: { classification: after, batchId },
        source: input.auditSource ?? 'apply-consumption-classifications',
        note: input.auditNote,
      })
    }
    return {
      success: true,
      revision: result.state.data_revision,
      previewToken: result.previewToken,
      applicable: true,
      changed: true,
      items: appliedItems,
      errors: [],
      guidance: result.plan.guidance,
      batchId,
    }
  })
}

const treatment = z.enum(consumptionRoles)
const auditFields = {
  auditSource: z.string().trim().min(1).max(120).optional(),
  auditNote: z.string().trim().min(1).max(1000).optional(),
}
const targetSchema = z
  .object({
    transactionId: z.string().trim().min(1).max(128),
    splitId: z.string().trim().min(1).max(128).nullable().optional(),
    builtinRole: treatment.optional(),
    customTypeId: z.string().trim().min(1).max(128).optional(),
    expectedRevisionId: z.string().trim().min(1).max(128).optional(),
    referencedPurchaseId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const builtin = Boolean(value.builtinRole)
    const custom = Boolean(value.customTypeId || value.expectedRevisionId)
    if (builtin === custom)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one builtin role or custom type.',
      })
    if (custom && (!value.customTypeId || !value.expectedRevisionId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom type and expected revision are required.',
      })
  })

const listClassificationTypes: ToolDefinition = {
  name: 'list-classification-types',
  description:
    'Discover fixed economic effects, eligible directions, reference requirements, active custom heads, immutable history, and Receivables/investment/card-payment workflow boundaries. Read-only.',
  schema: z.object({ includeArchived: z.boolean().optional().default(false) }).strict(),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) => ({
    success: true,
    ...listClassificationTypesService(input.includeArchived),
  }),
}
const createClassificationType: ToolDefinition = {
  name: 'create-classification-type',
  description:
    'Create an audited named type mapped to one fixed financial treatment. No custom formula or transaction mutation.',
  schema: z
    .object({
      name: z.string().trim().min(1).max(100),
      financialTreatment: treatment,
      ...auditFields,
    })
    .strict(),
  effects: {
    writesTo: [
      'classification_types',
      'classification_type_revisions',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => createClassificationTypeService(input),
}
const reviseClassificationType: ToolDefinition = {
  name: 'revise-classification-type',
  description:
    'Append an immutable named-type revision after checking the expected current head. Existing assignments remain pinned.',
  schema: z
    .object({
      typeId: z.string().trim().min(1).max(128),
      expectedRevisionId: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(100),
      financialTreatment: treatment,
      ...auditFields,
    })
    .strict(),
  effects: {
    writesTo: [
      'classification_types',
      'classification_type_revisions',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => reviseClassificationTypeService(input),
}
const archiveClassificationType: ToolDefinition = {
  name: 'archive-classification-type',
  description:
    'Archive a custom type after checking its current head. Historical pinned assignments and reports remain valid.',
  schema: z
    .object({
      typeId: z.string().trim().min(1).max(128),
      expectedRevisionId: z.string().trim().min(1).max(128),
      ...auditFields,
    })
    .strict(),
  effects: { writesTo: ['classification_types', 'audit_log', 'app_data_state'] },
  execute: async (input) => archiveClassificationTypeService(input),
}
const previewConsumptionClassifications: ToolDefinition = {
  name: 'preview-consumption-classifications',
  description:
    'Read-only atomic preview for 1-100 explicit allocations. Validates final-state direction, references, independent caps, dependents, custom heads, and protected workflows; never approves review state.',
  schema: z.object({ allocations: z.array(targetSchema).min(1).max(100) }).strict(),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) =>
    previewConsumptionClassificationsService(input.allocations as ClassificationBatchTarget[]),
}
const applyConsumptionClassifications: ToolDefinition = {
  name: 'apply-consumption-classifications',
  description:
    'Atomically apply the exact reviewed classification preview. Rejects stale database identity/revision/evidence/type heads and performs no partial writes.',
  schema: z
    .object({
      allocations: z.array(targetSchema).min(1).max(100),
      previewToken: z.string().trim().min(1),
      ...auditFields,
    })
    .strict(),
  effects: { writesTo: ['transaction_consumption_classifications', 'audit_log', 'app_data_state'] },
  execute: async (input) =>
    applyConsumptionClassificationsService({
      ...input,
      targets: input.allocations as ClassificationBatchTarget[],
    }),
}

export const classificationTools: ToolDefinition[] = [
  listClassificationTypes,
  createClassificationType,
  reviseClassificationType,
  archiveClassificationType,
  previewConsumptionClassifications,
  applyConsumptionClassifications,
]
