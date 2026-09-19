import {
  importPlanToken,
  prepareImportIdentities,
  sha256Fingerprint,
} from '@shikin/finance-core/imports'
import { query, withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { useTransactionStore } from '@/stores/transaction-store'

export type LegacyImportIdentityInput = {
  transactionId: string
  sourceNamespace: string
  externalId: string
  source?: string
  note?: string
}

export type LegacyImportIdentityTransaction = {
  id: string
  account_id: string
  category_id: string | null
  subcategory_id: string | null
  transfer_to_account_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string
  description: string
  notes: string | null
  date: string
  status: string | null
  source: string | null
  note: string | null
  ledger_treatment: string | null
  reporting_treatment: string | null
  transaction_kind: string | null
  staging_batch_id: string | null
  finalization_id: string | null
  reconciliation_id: string | null
  matched_transaction_id: string | null
  import_source: string | null
  import_external_id: string | null
  import_fingerprint: string | null
  import_content_fingerprint: string | null
  is_archived: number | null
  created_at: string
  updated_at: string
  [column: string]: unknown
}

type DataState = { database_id: string; data_revision: number }

type BindingMaterial = {
  transaction: LegacyImportIdentityTransaction
  namespace: string
  identity: ReturnType<typeof prepareImportIdentities>[number]
  state: DataState
  previewToken: string
}

export type LegacyImportIdentityPreview = {
  previewToken: string
  transaction: LegacyImportIdentityTransaction
  binding: {
    transactionId: string
    importSource: string
    importExternalId: string
    importFingerprint: string
    importContentFingerprint: null
    originalContentVerified: false
  }
  limitation: string
}

const UNKNOWN_CONTENT_LIMITATION =
  'Original source content is unknown. No content fingerprint was fabricated from the possibly edited ledger row.'

async function transactionById(
  tx: Pick<TransactionClient, 'query'>,
  transactionId: string
): Promise<LegacyImportIdentityTransaction> {
  const row = (
    await tx.query<LegacyImportIdentityTransaction>(
      'SELECT * FROM transactions WHERE id = ? LIMIT 1',
      [transactionId]
    )
  )[0]
  if (!row) throw new Error(`Transaction ${transactionId} not found.`)
  return row
}

function assertInput(input: LegacyImportIdentityInput): string {
  const namespace = input.sourceNamespace.trim()
  if (!namespace) throw new Error('Source namespace is required.')
  if (!input.externalId || !input.externalId.trim()) throw new Error('External ID is required.')
  return namespace
}

async function bindingMaterial(
  tx: TransactionClient,
  input: LegacyImportIdentityInput
): Promise<BindingMaterial> {
  const namespace = assertInput(input)
  const transaction = await transactionById(tx, input.transactionId)
  if (transaction.is_archived === 1 || (transaction.transaction_kind ?? 'standard') !== 'standard')
    throw new Error(
      'Only active standard ledger rows can receive a legacy import identity binding.'
    )
  if (transaction.import_content_fingerprint !== null)
    throw new Error('Transaction already has verified immutable import content evidence.')

  const identity = prepareImportIdentities(
    [
      {
        accountId: transaction.account_id,
        sourceNamespace: namespace,
        externalId: input.externalId,
        date: transaction.date,
        type: transaction.type,
        amountCentavos: transaction.amount,
        currency: transaction.currency,
        description: transaction.description,
      },
    ],
    [
      {
        accountId: transaction.account_id,
        sourceNamespace: namespace,
        externalId: input.externalId,
        date: transaction.date,
        type: transaction.type,
        amountCentavos: transaction.amount,
        currency: transaction.currency,
        transferToAccountId: transaction.transfer_to_account_id,
      },
    ]
  )[0]!

  const collision = (
    await tx.query<{ id: string }>(
      `SELECT id FROM transactions
       WHERE account_id = ? AND import_source = ? AND import_external_id = ? AND id <> ?
       ORDER BY id LIMIT 1`,
      [transaction.account_id, namespace, input.externalId, transaction.id]
    )
  )[0]
  if (collision) throw new Error(`Source identity is already bound to transaction ${collision.id}.`)

  if (
    (transaction.import_source ||
      transaction.import_external_id ||
      transaction.import_fingerprint) &&
    (transaction.import_source !== namespace ||
      transaction.import_external_id !== input.externalId ||
      transaction.import_fingerprint !== identity.identity.canonicalMaterial)
  )
    throw new Error('Transaction already has a different import identity.')

  const state = (
    await tx.query<DataState>(
      'SELECT database_id, data_revision FROM app_data_state WHERE id = 1 LIMIT 1'
    )
  )[0]
  if (!state) throw new Error('Import identity binding requires app_data_state.')

  const previewToken = importPlanToken({
    version: 1,
    operation: 'bind-transaction-import-identity',
    databaseId: state.database_id,
    dataRevision: state.data_revision,
    transactionId: transaction.id,
    sourceNamespace: namespace,
    externalId: input.externalId,
    existingEvidence: sha256Fingerprint(JSON.stringify(transaction)),
    identityKey: identity.identityKey,
    source: input.source ?? null,
    note: input.note ?? null,
  })
  return { transaction, namespace, identity, state, previewToken }
}

function previewFromMaterial(material: BindingMaterial): LegacyImportIdentityPreview {
  const identity = material.identity.identity
  if (identity.strategy !== 'external_id' || !identity.canonicalMaterial)
    throw new Error('Explicit external ID identity could not be prepared.')
  return {
    previewToken: material.previewToken,
    transaction: material.transaction,
    binding: {
      transactionId: material.transaction.id,
      importSource: material.namespace,
      importExternalId: identity.externalId,
      importFingerprint: identity.canonicalMaterial,
      importContentFingerprint: null,
      originalContentVerified: false,
    },
    limitation: UNKNOWN_CONTENT_LIMITATION,
  }
}

export async function readLegacyImportIdentityTransaction(
  transactionId: string
): Promise<LegacyImportIdentityTransaction> {
  return transactionById({ query }, transactionId)
}

export async function previewLegacyImportIdentity(
  input: LegacyImportIdentityInput
): Promise<LegacyImportIdentityPreview> {
  return withTransaction(async (tx) => previewFromMaterial(await bindingMaterial(tx, input)))
}

export async function bindLegacyImportIdentity(
  input: LegacyImportIdentityInput & { previewToken: string }
): Promise<LegacyImportIdentityPreview & { refreshIncomplete: boolean }> {
  const result = await withTransaction(async (tx) => {
    const material = await bindingMaterial(tx, input)
    if (!input.previewToken || input.previewToken !== material.previewToken)
      throw new Error(
        'A matching current preview token is required for explicit legacy identity binding. Preview again.'
      )
    const preview = previewFromMaterial(material)
    const update = await tx.execute(
      `UPDATE transactions
          SET import_source = ?, import_external_id = ?, import_fingerprint = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND import_content_fingerprint IS NULL`,
      [
        preview.binding.importSource,
        preview.binding.importExternalId,
        preview.binding.importFingerprint,
        material.transaction.id,
      ]
    )
    if (update.rowsAffected !== 1) throw new Error('Legacy identity binding became stale.')
    await tx.execute(
      `INSERT INTO audit_log (
         id, entity, entity_id, action, before_json, after_json, source, note
       ) VALUES (?, 'transaction', ?, 'bind-import-identity', ?, ?, ?, ?)`,
      [
        generateId(),
        material.transaction.id,
        JSON.stringify({
          importSource: material.transaction.import_source,
          importExternalId: material.transaction.import_external_id,
          importFingerprint: material.transaction.import_fingerprint,
        }),
        JSON.stringify(preview.binding),
        input.source ?? null,
        input.note ?? null,
      ]
    )
    return preview
  })

  const refresh = await Promise.allSettled([useTransactionStore.getState().fetch()])
  return { ...result, refreshIncomplete: refresh.some((item) => item.status === 'rejected') }
}
