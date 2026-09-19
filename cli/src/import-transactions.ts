import {
  canonicalReviewDecisions,
  importPlanToken,
  prepareImportIdentities,
  sha256Fingerprint,
  type ImportReviewDecision,
} from '@shikin/finance-core/imports'
import { execute, generateId, query, transaction, writeAuditLog } from './tools/shared.js'
import {
  createImportedTransactionSync,
  validateImportedTransactionSync,
  type ImportedTransactionCreateInput,
} from './tools/transactions.js'

export type AtomicImportRow = {
  row: number
  lineNumber: number
  input: Omit<
    ImportedTransactionCreateInput,
    | 'id'
    | 'amountCentavos'
    | 'importSource'
    | 'importExternalId'
    | 'importFingerprint'
    | 'importContentFingerprint'
  > & { amountCentavos: number }
  externalId: string | null
}

export type AtomicImportOptions = {
  accountId: string
  accountCurrency: string
  sourceNamespace: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
}

export type AtomicImportRequest = {
  rawContent: string
  rows: AtomicImportRow[]
  options: AtomicImportOptions
  decisions?: ImportReviewDecision[]
  previewToken?: string
  apply: boolean
}

type ExistingImportRow = {
  id: string
  account_id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  currency: string
  date: string
  description: string
  transfer_to_account_id: string | null
  import_source: string | null
  import_external_id: string | null
  import_fingerprint: string | null
  import_content_fingerprint: string | null
  updated_at: string | null
}

type PlannedRow = {
  row: number
  lineNumber: number
  status: 'create' | 'idempotent' | 'keep_existing' | 'distinct'
  identityKey: string
  importFingerprint: string
  contentFingerprint: string
  externalId: string | null
  existingTransactionId?: string
  legacyEvidenceUnverified?: boolean
  input: AtomicImportRow['input']
  reviewDecisions?: ImportReviewDecision[]
}

type ImportPlan = {
  revision: number
  databaseId: string
  token: string
  rows: PlannedRow[]
  conflicts: Array<Record<string, unknown>>
  requiredDecisions: Array<Record<string, unknown>>
  unusedDecisions: ImportReviewDecision[]
}

function currentState(): { databaseId: string; revision: number } {
  const states = query<{ database_id: string; data_revision: number }>(
    'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
  )
  const state = states[0]
  if (!state || !state.database_id || !Number.isSafeInteger(state.data_revision)) {
    throw new Error('Import requires a ready app_data_state singleton.')
  }
  return { databaseId: state.database_id, revision: state.data_revision }
}

function existingEvidenceFingerprint(row: ExistingImportRow): string {
  return sha256Fingerprint(
    JSON.stringify({
      version: 1,
      namespace: 'shikin-existing-import-evidence',
      id: row.id,
      accountId: row.account_id,
      sourceNamespace: row.import_source,
      externalId: row.import_external_id,
      identityFingerprint: row.import_fingerprint,
      contentFingerprint: row.import_content_fingerprint,
      type: row.type,
      amountCentavos: row.amount,
      currency: row.currency,
      date: row.date,
      transferToAccountId: row.transfer_to_account_id,
      updatedAt: row.updated_at,
    })
  )
}

function exactIdentityRows(
  row: AtomicImportRow,
  sourceNamespace: string,
  importFingerprint: string
): ExistingImportRow[] {
  if (row.externalId !== null) {
    return query<ExistingImportRow>(
      `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
              import_source, import_external_id, import_fingerprint, import_content_fingerprint, updated_at
       FROM transactions
       WHERE account_id = $1 AND import_source = $2 AND import_external_id = $3
       ORDER BY id`,
      [row.input.accountId, sourceNamespace, row.externalId]
    )
  }
  return query<ExistingImportRow>(
    `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
            import_source, import_external_id, import_fingerprint, import_content_fingerprint, updated_at
     FROM transactions WHERE account_id = $1 AND import_fingerprint = $2 ORDER BY id`,
    [row.input.accountId, importFingerprint]
  )
}

function ambiguousCandidates(row: AtomicImportRow, accountCurrency: string): ExistingImportRow[] {
  return query<ExistingImportRow>(
    `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
            import_source, import_external_id, import_fingerprint, import_content_fingerprint, updated_at
     FROM transactions
     WHERE account_id = $1 AND type = $2 AND amount = $3 AND UPPER(currency) = $4
       AND date BETWEEN date($5, '-1 day') AND date($6, '+1 day')
       AND COALESCE(is_archived, 0) = 0
     ORDER BY date DESC, created_at DESC, id DESC`,
    [
      row.input.accountId,
      row.input.type,
      row.input.amountCentavos,
      accountCurrency.toUpperCase(),
      row.input.date,
      row.input.date,
    ]
  )
}

function hasVerifiedExternalIdentity(row: ExistingImportRow): boolean {
  return Boolean(row.import_source?.trim() && row.import_external_id?.trim())
}

function findDecision(
  decisions: readonly ImportReviewDecision[],
  identityKey: string,
  contentFingerprint: string,
  existing: ExistingImportRow
): ImportReviewDecision | undefined {
  const evidence = existingEvidenceFingerprint(existing)
  return decisions.find(
    (decision) =>
      decision.candidateIdentityKey === identityKey &&
      decision.candidateContentFingerprint === contentFingerprint &&
      decision.existingTransactionId === existing.id &&
      decision.existingEvidenceFingerprint === evidence
  )
}

function readPersistedDecision(
  identityKey: string,
  contentFingerprint: string,
  existing: ExistingImportRow
): ImportReviewDecision | undefined {
  const evidence = existingEvidenceFingerprint(existing)
  return query<ImportReviewDecision>(
    `SELECT candidate_identity_key AS candidateIdentityKey,
            candidate_content_fingerprint AS candidateContentFingerprint,
            existing_transaction_id AS existingTransactionId,
            existing_evidence_fingerprint AS existingEvidenceFingerprint,
            decision
     FROM duplicate_review_decisions
     WHERE account_id = $1 AND candidate_identity_key = $2
       AND candidate_content_fingerprint = $3 AND existing_transaction_id = $4
       AND existing_evidence_fingerprint = $5
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [rowAccount(existing), identityKey, contentFingerprint, existing.id, evidence]
  )[0]
}

function rowAccount(row: ExistingImportRow): string {
  return row.account_id
}

function planImport(request: AtomicImportRequest): ImportPlan {
  const state = currentState()
  const decisions = canonicalReviewDecisions(request.decisions ?? [])
  const identityInputs = request.rows.map((row) => ({
    accountId: row.input.accountId,
    sourceNamespace: request.options.sourceNamespace,
    date: row.input.date,
    type: row.input.type,
    amountCentavos: row.input.amountCentavos,
    currency: request.options.accountCurrency,
    description: row.input.description,
    externalId: row.externalId,
  }))
  const prepared = prepareImportIdentities(
    identityInputs,
    request.rows.map((row) => ({
      accountId: row.input.accountId,
      sourceNamespace: request.options.sourceNamespace,
      externalId: row.externalId,
      date: row.input.date,
      type: row.input.type,
      amountCentavos: row.input.amountCentavos,
      currency: request.options.accountCurrency,
      transferToAccountId: null,
    }))
  )
  for (const [index, row] of request.rows.entries()) {
    validateImportedTransactionSync({
      ...row.input,
      importSource: request.options.sourceNamespace,
      importExternalId: row.externalId,
      importFingerprint: prepared[index].identity.canonicalMaterial!,
      importContentFingerprint: prepared[index].contentFingerprint,
    })
  }
  const rows: PlannedRow[] = []
  const conflicts: Array<Record<string, unknown>> = []
  const requiredDecisions: Array<Record<string, unknown>> = []
  const usedDecisions = new Set<ImportReviewDecision>()
  const earlierByIdentity = new Map<string, PlannedRow>()

  for (const [index, candidate] of request.rows.entries()) {
    const identity = prepared[index]
    const earlier = earlierByIdentity.get(identity.identityKey)
    if (earlier) {
      if (earlier.contentFingerprint !== identity.contentFingerprint) {
        conflicts.push({
          row: candidate.row,
          reason: 'intrafile_identity_content_conflict',
          identityKey: identity.identityKey,
          earlierRow: earlier.row,
        })
        continue
      }
      rows.push({
        row: candidate.row,
        lineNumber: candidate.lineNumber,
        status: 'idempotent',
        identityKey: identity.identityKey,
        importFingerprint: identity.identity.canonicalMaterial!,
        contentFingerprint: identity.contentFingerprint,
        externalId: candidate.externalId,
        input: candidate.input,
      })
      continue
    }

    const exact = exactIdentityRows(
      candidate,
      request.options.sourceNamespace,
      identity.identity.canonicalMaterial!
    )
    if (exact.length > 1) {
      conflicts.push({
        row: candidate.row,
        reason: 'ambiguous_existing_identity',
        identityKey: identity.identityKey,
        existingTransactionIds: exact.map((existing) => existing.id),
      })
      continue
    }
    const existing = exact[0]
    if (existing) {
      const verifiedContent = existing.import_content_fingerprint
      const legacyMatches =
        existing.account_id === candidate.input.accountId &&
        existing.type === candidate.input.type &&
        existing.amount === candidate.input.amountCentavos &&
        existing.currency.trim().toUpperCase() === request.options.accountCurrency.toUpperCase() &&
        existing.date === candidate.input.date &&
        existing.transfer_to_account_id === null
      if (
        (verifiedContent && verifiedContent !== identity.contentFingerprint) ||
        (!verifiedContent && !legacyMatches)
      ) {
        conflicts.push({
          row: candidate.row,
          reason: 'identity_financial_content_conflict',
          identityKey: identity.identityKey,
          existingTransactionId: existing.id,
          legacyEvidenceUnverified: !verifiedContent,
        })
        continue
      }
      const planned: PlannedRow = {
        row: candidate.row,
        lineNumber: candidate.lineNumber,
        status: 'idempotent',
        identityKey: identity.identityKey,
        importFingerprint: identity.identity.canonicalMaterial!,
        contentFingerprint: identity.contentFingerprint,
        externalId: candidate.externalId,
        existingTransactionId: existing.id,
        legacyEvidenceUnverified: !verifiedContent,
        input: candidate.input,
      }
      rows.push(planned)
      earlierByIdentity.set(identity.identityKey, planned)
      continue
    }

    let plannedStatus: PlannedRow['status'] = 'create'
    const reviewedDecisions: ImportReviewDecision[] = []
    let reviewedExisting: ExistingImportRow | undefined
    const candidates = ambiguousCandidates(candidate, request.options.accountCurrency)
    for (const possible of candidates) {
      // Different durable external identities are authoritative. An incoming ID alone does not
      // identify an otherwise unbound legacy row, so that candidate still requires review.
      if (candidate.externalId !== null && hasVerifiedExternalIdentity(possible)) continue
      const decision =
        findDecision(decisions, identity.identityKey, identity.contentFingerprint, possible) ??
        readPersistedDecision(identity.identityKey, identity.contentFingerprint, possible)
      if (!decision) {
        requiredDecisions.push({
          row: candidate.row,
          candidateIdentityKey: identity.identityKey,
          candidateContentFingerprint: identity.contentFingerprint,
          existingTransactionId: possible.id,
          existingEvidenceFingerprint: existingEvidenceFingerprint(possible),
          allowedDecisions: ['keep_existing', 'distinct'],
        })
        continue
      }
      const supplied = decisions.find((item) => item === decision)
      if (supplied) usedDecisions.add(supplied)
      if (decision.decision === 'keep_existing') {
        plannedStatus = 'keep_existing'
        reviewedExisting = possible
      } else if (plannedStatus !== 'keep_existing') {
        plannedStatus = 'distinct'
        reviewedExisting = possible
      }
      reviewedDecisions.push(decision)
    }
    const planned: PlannedRow = {
      row: candidate.row,
      lineNumber: candidate.lineNumber,
      status: plannedStatus,
      identityKey: identity.identityKey,
      importFingerprint: identity.identity.canonicalMaterial!,
      contentFingerprint: identity.contentFingerprint,
      externalId: candidate.externalId,
      existingTransactionId: reviewedExisting?.id,
      input: candidate.input,
      reviewDecisions: reviewedDecisions.length ? reviewedDecisions : undefined,
    }
    rows.push(planned)
    earlierByIdentity.set(identity.identityKey, planned)
  }

  const unusedDecisions = decisions.filter((decision) => !usedDecisions.has(decision))
  if (unusedDecisions.length) {
    conflicts.push({ reason: 'unused_or_stale_review_decisions', count: unusedDecisions.length })
  }
  const planBinding = rows.map((row) => ({
    row: row.row,
    status: row.status,
    identityKey: row.identityKey,
    contentFingerprint: row.contentFingerprint,
    existingTransactionId: row.existingTransactionId ?? null,
  }))
  const token = importPlanToken({
    version: 1,
    rawFileDigest: sha256Fingerprint(request.rawContent),
    databaseId: state.databaseId,
    dataRevision: state.revision,
    options: request.options,
    decisions,
    plan: planBinding,
    conflicts,
    requiredDecisions,
  })
  return {
    revision: state.revision,
    databaseId: state.databaseId,
    token,
    rows,
    conflicts,
    requiredDecisions,
    unusedDecisions,
  }
}

function persistDecision(accountId: string, decision: ImportReviewDecision): void {
  const existing = query<{ id: string }>(
    `SELECT id FROM duplicate_review_decisions
     WHERE account_id=$1 AND candidate_identity_key=$2 AND candidate_content_fingerprint=$3
       AND existing_transaction_id=$4 AND existing_evidence_fingerprint=$5 AND decision=$6 LIMIT 1`,
    [
      accountId,
      decision.candidateIdentityKey,
      decision.candidateContentFingerprint,
      decision.existingTransactionId,
      decision.existingEvidenceFingerprint,
      decision.decision,
    ]
  )[0]
  if (existing) return
  const id = generateId()
  const source = 'csv-import'
  const note = 'Reviewed during atomic CSV import'
  execute(
    `INSERT INTO duplicate_review_decisions
       (id, account_id, existing_transaction_id, candidate_identity_key,
        candidate_content_fingerprint, existing_evidence_fingerprint, decision, source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      accountId,
      decision.existingTransactionId,
      decision.candidateIdentityKey,
      decision.candidateContentFingerprint,
      decision.existingEvidenceFingerprint,
      decision.decision,
      source,
      note,
    ]
  )
  writeAuditLog({
    entity: 'duplicate_review_decision',
    entityId: id,
    action: 'review-import-duplicate',
    before: null,
    after: { id, accountId, ...decision, source, note },
    source,
    note,
  })
}

function publicPlan(
  plan: ImportPlan,
  applyMode: 'preview' | 'reviewed_atomic' | 'unreviewed_atomic'
) {
  const imported = plan.rows.filter(
    (row) => row.status === 'create' || row.status === 'distinct'
  ).length
  const skipped = plan.rows.length - imported
  return {
    success: plan.conflicts.length === 0 && plan.requiredDecisions.length === 0,
    mode: applyMode,
    previewToken: plan.token,
    databaseId: plan.databaseId,
    dataRevision: plan.revision,
    summary: {
      totalRows: plan.rows.length + plan.conflicts.length,
      importedRows: imported,
      skippedRows: skipped,
    },
    rows: plan.rows.map(({ input: _input, reviewDecisions: _reviewDecisions, ...row }) => row),
    conflicts: plan.conflicts,
    requiredDecisions: plan.requiredDecisions,
    ...(plan.unusedDecisions.length ? { unusedDecisions: plan.unusedDecisions } : {}),
  }
}

export function executeAtomicImport(request: AtomicImportRequest): Record<string, unknown> {
  if (!request.apply) {
    return transaction(() => publicPlan(planImport(request), 'preview'))
  }
  return transaction(() => {
    const plan = planImport(request)
    if (request.previewToken && request.previewToken !== plan.token) {
      throw new Error(
        'The supplied import preview token is stale or does not match this file, options, decisions, or database revision. No rows were imported.'
      )
    }
    if (plan.conflicts.length || plan.requiredDecisions.length) {
      throw new Error(
        'The atomic import plan has unresolved conflicts or duplicate decisions. No rows were imported.'
      )
    }
    for (const row of plan.rows) {
      for (const decision of row.reviewDecisions ?? []) {
        if (
          (request.decisions ?? []).some(
            (item) =>
              item.candidateIdentityKey === decision.candidateIdentityKey &&
              item.candidateContentFingerprint === decision.candidateContentFingerprint &&
              item.existingTransactionId === decision.existingTransactionId &&
              item.existingEvidenceFingerprint === decision.existingEvidenceFingerprint &&
              item.decision === decision.decision
          )
        ) {
          persistDecision(request.options.accountId, decision)
        }
      }
      if (row.status !== 'create' && row.status !== 'distinct') continue
      createImportedTransactionSync({
        ...row.input,
        importSource: request.options.sourceNamespace,
        importExternalId: row.externalId,
        importFingerprint: row.importFingerprint,
        importContentFingerprint: row.contentFingerprint,
      })
    }
    return publicPlan(plan, request.previewToken ? 'reviewed_atomic' : 'unreviewed_atomic')
  })
}
