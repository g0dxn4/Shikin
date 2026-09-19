import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import {
  canonicalReviewDecisions,
  importPlanToken,
  prepareImportIdentities,
  sha256Fingerprint,
  type ImportReviewDecision,
} from '@shikin/finance-core/imports'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'

export type StatementImportTreatment = 'posted' | 'staged_posted' | 'staged_pending'

export interface StatementImportTreatmentOptions {
  treatment?: StatementImportTreatment
  stagingBatchId?: string
  acknowledgePending?: boolean
}

export interface StatementImportApplyOptions extends StatementImportTreatmentOptions {
  previewToken?: string
  decisions?: readonly ImportReviewDecision[]
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  mode?: 'reviewed_atomic' | 'unreviewed_atomic'
}

export interface StatementImportReviewCandidate {
  candidateIdentityKey: string
  existingTransactionId: string
  incoming: {
    rowIndex: number
    date: string
    description: string
    type: 'income' | 'expense'
    amountCentavos: number
    currency: string
  }
  existing: {
    id: string
    date: string
    description: string
    type: string
    amountCentavos: number
    currency: string
  }
}

export interface StatementImportPreview {
  success: boolean
  parsedTransactions: ParsedTransaction[]
  previewToken: string | null
  imported: number
  skipped: number
  errors: string[]
  requiredDecisions: ImportReviewDecision[]
  reviewCandidates: StatementImportReviewCandidate[]
  limitations: string[]
  legacyEvidenceLimitations: string[]
  treatment: StatementImportTreatment
  stagingBatchId: string | null
  stagedCount: number
  pendingCount: number
  balanceImpactCentavos: number
  accountCurrency: string | null
}

type NormalizedStatementImportTreatment = {
  treatment: StatementImportTreatment
  status: 'posted' | 'pending'
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  stagingBatchId: string | null
  pendingAcknowledged: boolean
}

type AccountRow = {
  currency: string | null
  balance: number
  account_mode?: 'transactional' | 'snapshot_only' | null
  is_archived: number | null
}

type ExistingRow = {
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

type PlannedStatementRow = {
  transaction: ParsedTransaction & { type: 'income' | 'expense' }
  amountCentavos: number
  importFingerprint: string
  contentFingerprint: string
  identityKey: string
  action: 'create' | 'skip' | 'distinct' | 'keep_existing'
  existingTransactionId?: string
  decisions?: ImportReviewDecision[]
}

type StatementPlan = {
  accountCurrency: string
  accountBalance: number
  importTreatment: NormalizedStatementImportTreatment
  databaseId: string
  revision: number
  rows: PlannedStatementRow[]
  requiredDecisions: ImportReviewDecision[]
  reviewCandidates: StatementImportReviewCandidate[]
  sourceLimitations: string[]
  legacyEvidenceLimitations: string[]
  token: string
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function assertSupportedType(
  transaction: ParsedTransaction
): asserts transaction is ParsedTransaction & { type: 'income' | 'expense' } {
  if (transaction.type !== 'income' && transaction.type !== 'expense') {
    throw new Error(
      `Unsupported imported transaction type "${String(transaction.type)}" for "${transaction.description}" (${transaction.date})`
    )
  }
}

function statementSourceNamespace(fileName: string): string {
  const extension = fileName.split('.').pop()?.trim().toLowerCase()
  return `statement:${extension || 'unknown'}`
}

function evidenceFingerprint(row: ExistingRow): string {
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

async function validateAccount(tx: TransactionClient, accountId: string): Promise<AccountRow> {
  const account = (
    await tx.query<AccountRow>(
      'SELECT currency, balance, account_mode, is_archived FROM accounts WHERE id = ? LIMIT 1',
      [accountId]
    )
  )[0]
  if (!account) throw new Error(`Account ${accountId} not found`)
  if (account.is_archived !== 0) {
    throw new Error(`Account ${accountId} is archived and cannot accept statement imports`)
  }
  const mode = account.account_mode ?? 'transactional'
  if (mode === 'snapshot_only')
    throw new Error('Snapshot-only accounts do not accept transaction ledger imports')
  if (mode !== 'transactional')
    throw new Error(`Account ${accountId} has unsupported account mode "${mode}"`)
  if (typeof account.currency !== 'string' || !account.currency.trim()) {
    throw new Error(`Account ${accountId} has no stored currency`)
  }
  if (!Number.isSafeInteger(account.balance)) {
    throw new Error(`Account ${accountId} balance is outside the safe integer range`)
  }
  return account
}

function hasDistinctSameSourceExternalIdentity(
  row: ExistingRow,
  sourceNamespace: string,
  externalId: string | null
): boolean {
  const existingSource = row.import_source?.trim()
  const incomingSource = sourceNamespace.trim()
  const existingExternalId = row.import_external_id
  return Boolean(
    existingSource &&
    incomingSource &&
    existingSource === incomingSource &&
    existingExternalId?.trim() &&
    externalId?.trim() &&
    existingExternalId !== externalId
  )
}

function normalizeImportTreatment(
  options: StatementImportTreatmentOptions,
  input: {
    content: string
    fileName: string
    accountId: string
    sourceNamespace: string
  }
): NormalizedStatementImportTreatment {
  const treatment = options.treatment ?? 'posted'
  if (!['posted', 'staged_posted', 'staged_pending'].includes(treatment)) {
    throw new Error(`Unsupported statement import treatment "${String(treatment)}"`)
  }
  if (treatment === 'posted') {
    if (options.stagingBatchId?.trim()) {
      throw new Error('A staging batch identifier is only valid for a staged import')
    }
    return {
      treatment,
      status: 'posted',
      ledgerTreatment: 'normal',
      stagingBatchId: null,
      pendingAcknowledged: false,
    }
  }
  if (treatment === 'staged_pending' && options.acknowledgePending !== true) {
    throw new Error('Pending holds require an explicit operator acknowledgement')
  }
  const explicitBatchId = options.stagingBatchId?.trim()
  if (explicitBatchId && explicitBatchId.length > 200) {
    throw new Error('Staging batch identifier must be 200 characters or fewer')
  }
  const stagingBatchId =
    explicitBatchId ||
    `statement-import-${sha256Fingerprint(
      JSON.stringify({
        version: 1,
        accountId: input.accountId,
        sourceNamespace: input.sourceNamespace,
        fileName: input.fileName,
        rawFileDigest: sha256Fingerprint(input.content),
      })
    ).slice(7, 31)}`
  return {
    treatment,
    status: treatment === 'staged_pending' ? 'pending' : 'posted',
    ledgerTreatment: 'staged_no_balance_impact',
    stagingBatchId,
    pendingAcknowledged: treatment === 'staged_pending',
  }
}

async function createPlan(
  tx: TransactionClient,
  content: string,
  fileName: string,
  accountId: string,
  parsed: ParsedTransaction[],
  suppliedDecisions: readonly ImportReviewDecision[],
  options: StatementImportTreatmentOptions
): Promise<StatementPlan> {
  for (const transaction of parsed) assertSupportedType(transaction)
  const account = await validateAccount(tx, accountId)
  const accountCurrency = account.currency as string
  const declaredCurrencies = parsed.map((transaction) => transaction.currency?.trim().toUpperCase())
  const knownCurrencies = [
    ...new Set(declaredCurrencies.filter((value): value is string => Boolean(value))),
  ]
  if (
    knownCurrencies.length > 1 ||
    (knownCurrencies.length === 1 && declaredCurrencies.some((value) => !value))
  ) {
    throw new Error('Statement has an unsupported mixed or incomplete currency scope')
  }
  if (knownCurrencies[0] && knownCurrencies[0] !== accountCurrency.trim().toUpperCase()) {
    throw new Error(
      `Statement currency ${knownCurrencies[0]} does not match account currency ${accountCurrency}`
    )
  }
  const sourceLimitations = knownCurrencies.length
    ? []
    : [`Statement source did not declare a currency; amounts are assumed to be ${accountCurrency}.`]
  const state = (
    await tx.query<{ database_id: string; data_revision: number }>(
      'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
    )
  )[0]
  if (!state || !state.database_id || !Number.isSafeInteger(state.data_revision)) {
    throw new Error('Statement import requires a ready app_data_state singleton')
  }
  const sourceNamespace = statementSourceNamespace(fileName)
  const importTreatment = normalizeImportTreatment(options, {
    content,
    fileName,
    accountId,
    sourceNamespace,
  })
  const prepared = parsed.map((transaction) => ({
    transaction: transaction as ParsedTransaction & {
      type: 'income' | 'expense'
    },
    amountCentavos: toCentavos(transaction.amount),
  }))
  for (const row of prepared) {
    if (!Number.isSafeInteger(row.amountCentavos) || row.amountCentavos <= 0) {
      throw new Error(`Invalid imported amount for "${row.transaction.description}"`)
    }
  }
  const identities = prepareImportIdentities(
    prepared.map(({ transaction, amountCentavos }) => ({
      accountId,
      sourceNamespace,
      date: transaction.date,
      type: transaction.type,
      amountCentavos,
      currency: accountCurrency,
      description: transaction.description,
      externalId: transaction.externalId,
    })),
    prepared.map(({ transaction, amountCentavos }) => ({
      accountId,
      sourceNamespace,
      externalId: transaction.externalId,
      date: transaction.date,
      type: transaction.type,
      amountCentavos,
      currency: accountCurrency,
      transferToAccountId: null,
    }))
  )
  const decisions = canonicalReviewDecisions(suppliedDecisions)
  const used = new Set<ImportReviewDecision>()
  const requiredDecisions: ImportReviewDecision[] = []
  const reviewCandidates: StatementImportReviewCandidate[] = []
  const legacyEvidenceLimitations: string[] = []
  const rows: PlannedStatementRow[] = []
  const earlier = new Map<string, PlannedStatementRow>()

  for (const [index, preparedRow] of prepared.entries()) {
    const identity = identities[index]
    const previous = earlier.get(identity.identityKey)
    if (previous) {
      if (previous.contentFingerprint !== identity.contentFingerprint) {
        throw new Error(
          `Row ${index + 1} conflicts with an earlier row using the same source identity`
        )
      }
      rows.push({
        ...previous,
        transaction: preparedRow.transaction,
        action: 'skip',
      })
      continue
    }
    const externalId = preparedRow.transaction.externalId ?? null
    const exact =
      externalId !== null
        ? await tx.query<ExistingRow>(
            `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
                  import_source, import_external_id, import_fingerprint,
                  import_content_fingerprint, updated_at
           FROM transactions WHERE account_id = ? AND import_source = ? AND import_external_id = ? ORDER BY id`,
            [accountId, sourceNamespace, externalId]
          )
        : await tx.query<ExistingRow>(
            `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
                  import_source, import_external_id, import_fingerprint,
                  import_content_fingerprint, updated_at
           FROM transactions WHERE account_id = ? AND import_fingerprint = ? ORDER BY id`,
            [accountId, identity.identity.canonicalMaterial]
          )
    if (exact.length > 1)
      throw new Error(`Source identity for row ${index + 1} is ambiguous in existing data`)
    const match = exact[0]
    if (match) {
      const legacyMatches =
        match.account_id === accountId &&
        match.type === preparedRow.transaction.type &&
        match.amount === preparedRow.amountCentavos &&
        match.currency.toUpperCase() === accountCurrency.toUpperCase() &&
        match.date === preparedRow.transaction.date &&
        match.transfer_to_account_id === null
      if (
        (match.import_content_fingerprint &&
          match.import_content_fingerprint !== identity.contentFingerprint) ||
        (!match.import_content_fingerprint && !legacyMatches)
      ) {
        throw new Error(`Source identity for row ${index + 1} has changed financial content`)
      }
      if (!match.import_content_fingerprint) {
        legacyEvidenceLimitations.push(
          `Transaction ${match.id} has no verified original content fingerprint; current financial fields matched but editable original content cannot be inferred.`
        )
      }
      const planned: PlannedStatementRow = {
        ...preparedRow,
        importFingerprint: identity.identity.canonicalMaterial!,
        contentFingerprint: identity.contentFingerprint,
        identityKey: identity.identityKey,
        action: 'skip',
        existingTransactionId: match.id,
      }
      rows.push(planned)
      earlier.set(identity.identityKey, planned)
      continue
    }

    let action: PlannedStatementRow['action'] = 'create'
    const selectedDecisions: ImportReviewDecision[] = []
    let existingTransactionId: string | undefined
    const candidates = await tx.query<ExistingRow>(
      `SELECT id, account_id, type, amount, currency, date, description, transfer_to_account_id,
              import_source, import_external_id, import_fingerprint,
              import_content_fingerprint, updated_at
       FROM transactions
       WHERE account_id = ? AND type = ? AND amount = ? AND UPPER(currency) = ?
         AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')
         AND COALESCE(is_archived, 0) = 0
       ORDER BY date DESC, created_at DESC, id DESC`,
      [
        accountId,
        preparedRow.transaction.type,
        preparedRow.amountCentavos,
        accountCurrency.toUpperCase(),
        preparedRow.transaction.date,
        preparedRow.transaction.date,
      ]
    )
    for (const candidate of candidates) {
      // Only distinct IDs issued within the same namespace prove that two physical records differ.
      // Cross-namespace IDs and otherwise unbound legacy rows still require candidate review.
      if (hasDistinctSameSourceExternalIdentity(candidate, sourceNamespace, externalId)) continue
      const evidence = evidenceFingerprint(candidate)
      reviewCandidates.push({
        candidateIdentityKey: identity.identityKey,
        existingTransactionId: candidate.id,
        incoming: {
          rowIndex: index,
          date: preparedRow.transaction.date.slice(0, 10),
          description: preparedRow.transaction.description.slice(0, 200),
          type: preparedRow.transaction.type,
          amountCentavos: preparedRow.amountCentavos,
          currency: accountCurrency.slice(0, 10),
        },
        existing: {
          id: candidate.id,
          date: candidate.date.slice(0, 10),
          description: candidate.description.slice(0, 200),
          type: candidate.type,
          amountCentavos: candidate.amount,
          currency: candidate.currency.slice(0, 10),
        },
      })
      const supplied = decisions.find(
        (decision) =>
          decision.candidateIdentityKey === identity.identityKey &&
          decision.candidateContentFingerprint === identity.contentFingerprint &&
          decision.existingTransactionId === candidate.id &&
          decision.existingEvidenceFingerprint === evidence
      )
      const persisted = supplied
        ? undefined
        : (
            await tx.query<ImportReviewDecision>(
              `SELECT candidate_identity_key AS candidateIdentityKey,
                      candidate_content_fingerprint AS candidateContentFingerprint,
                      existing_transaction_id AS existingTransactionId,
                      existing_evidence_fingerprint AS existingEvidenceFingerprint, decision
               FROM duplicate_review_decisions
               WHERE account_id=? AND candidate_identity_key=? AND candidate_content_fingerprint=?
                 AND existing_transaction_id=? AND existing_evidence_fingerprint=?
               ORDER BY created_at DESC, id DESC LIMIT 1`,
              [accountId, identity.identityKey, identity.contentFingerprint, candidate.id, evidence]
            )
          )[0]
      const decision = supplied ?? persisted
      if (!decision) {
        requiredDecisions.push({
          candidateIdentityKey: identity.identityKey,
          candidateContentFingerprint: identity.contentFingerprint,
          existingTransactionId: candidate.id,
          existingEvidenceFingerprint: evidence,
          decision: 'keep_existing',
        })
        continue
      }
      if (supplied) used.add(supplied)
      selectedDecisions.push(decision)
      existingTransactionId = candidate.id
      if (decision.decision === 'keep_existing') action = 'keep_existing'
      else if (action !== 'keep_existing') action = 'distinct'
    }
    const planned: PlannedStatementRow = {
      ...preparedRow,
      importFingerprint: identity.identity.canonicalMaterial!,
      contentFingerprint: identity.contentFingerprint,
      identityKey: identity.identityKey,
      action,
      existingTransactionId,
      decisions: selectedDecisions.length ? selectedDecisions : undefined,
    }
    rows.push(planned)
    earlier.set(identity.identityKey, planned)
  }
  if (decisions.some((decision) => !used.has(decision))) {
    throw new Error(
      'One or more duplicate decisions are stale or do not belong to this statement plan'
    )
  }
  const token = importPlanToken({
    version: 1,
    rawFileDigest: sha256Fingerprint(content),
    fileName,
    accountId,
    sourceNamespace,
    databaseId: state.database_id,
    dataRevision: state.data_revision,
    decisions,
    rows: rows.map((row) => ({
      identityKey: row.identityKey,
      contentFingerprint: row.contentFingerprint,
      action: row.action,
      existingTransactionId: row.existingTransactionId ?? null,
    })),
    requiredDecisions,
    reviewCandidates,
    sourceLimitations,
    importTreatment,
  })
  return {
    accountCurrency,
    accountBalance: account.balance,
    importTreatment,
    databaseId: state.database_id,
    revision: state.data_revision,
    rows,
    requiredDecisions,
    reviewCandidates,
    sourceLimitations,
    legacyEvidenceLimitations,
    token,
  }
}

const MAX_SAFE_CENTAVOS = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_CENTAVOS = BigInt(Number.MIN_SAFE_INTEGER)

function assertSafeCentavos(value: bigint, label: string): void {
  if (value < MIN_SAFE_CENTAVOS || value > MAX_SAFE_CENTAVOS) {
    throw new Error(`${label} is outside the safe integer range`)
  }
}

function plannedBalanceDelta(plan: StatementPlan): number {
  let aggregate = 0n
  for (const row of plan.rows) {
    if (row.action !== 'create' && row.action !== 'distinct') continue
    const effect = BigInt(row.amountCentavos) * (row.transaction.type === 'income' ? 1n : -1n)
    aggregate += effect
    assertSafeCentavos(aggregate, 'Statement import balance delta')
  }
  if (plan.importTreatment.ledgerTreatment === 'staged_no_balance_impact') return 0
  const resultingBalance = BigInt(plan.accountBalance) + aggregate
  assertSafeCentavos(resultingBalance, 'Statement import resulting balance')
  return Number(aggregate)
}

async function writeImportAudit(
  tx: TransactionClient,
  input: {
    entity: 'transaction' | 'duplicate_review_decision'
    entityId: string
    action: 'create' | 'review-import-duplicate'
    before: unknown
    after: unknown
    source: string
    note: string
    createdAt: string
  }
): Promise<void> {
  await tx.execute(
    `INSERT INTO audit_log
       (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      input.entity,
      input.entityId,
      input.action,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.source,
      input.note,
      input.createdAt,
    ]
  )
}

async function parseFile(file: File): Promise<{ content: string; parsed: ParsedTransaction[] }> {
  const content = await readFileText(file)
  const parsed = parseStatement(content, file.name)
  if (!parsed.length) throw new Error('No transactions found in file')
  return { content, parsed }
}

export async function previewStatementFile(
  file: File,
  accountId: string,
  decisions: readonly ImportReviewDecision[] = [],
  options: StatementImportTreatmentOptions = {}
): Promise<StatementImportPreview> {
  try {
    const { content, parsed } = await parseFile(file)
    const plan = await withTransaction((tx) =>
      createPlan(tx, content, file.name, accountId, parsed, decisions, options)
    )
    const balanceImpactCentavos = plannedBalanceDelta(plan)
    const imported = plan.rows.filter(
      (row) => row.action === 'create' || row.action === 'distinct'
    ).length
    return {
      success: plan.requiredDecisions.length === 0,
      parsedTransactions: parsed,
      previewToken: plan.token,
      imported,
      skipped: plan.rows.filter((row) => row.action === 'skip' || row.action === 'keep_existing')
        .length,
      errors: [],
      requiredDecisions: plan.requiredDecisions,
      reviewCandidates: plan.reviewCandidates,
      limitations: [...plan.sourceLimitations, ...plan.legacyEvidenceLimitations],
      legacyEvidenceLimitations: plan.legacyEvidenceLimitations,
      treatment: plan.importTreatment.treatment,
      stagingBatchId: plan.importTreatment.stagingBatchId,
      stagedCount:
        plan.importTreatment.ledgerTreatment === 'staged_no_balance_impact' ? imported : 0,
      pendingCount: plan.importTreatment.status === 'pending' ? imported : 0,
      balanceImpactCentavos,
      accountCurrency: plan.accountCurrency,
    }
  } catch (error) {
    return {
      success: false,
      parsedTransactions: [],
      previewToken: null,
      imported: 0,
      skipped: 0,
      errors: [getErrorMessage(error)],
      requiredDecisions: [],
      reviewCandidates: [],
      limitations: [],
      legacyEvidenceLimitations: [],
      treatment: options.treatment ?? 'posted',
      stagingBatchId: null,
      stagedCount: 0,
      pendingCount: 0,
      balanceImpactCentavos: 0,
      accountCurrency: null,
    }
  }
}

export async function importStatementFile(
  file: File,
  accountId: string,
  options: StatementImportApplyOptions = {}
): Promise<ImportResult> {
  try {
    const { content, parsed } = await parseFile(file)
    const counts = await withTransaction(async (tx) => {
      const plan = await createPlan(
        tx,
        content,
        file.name,
        accountId,
        parsed,
        options.decisions ?? [],
        options
      )
      if (options.previewToken && options.previewToken !== plan.token) {
        throw new Error(
          'Statement preview is stale or does not match this file, account, decisions, or database revision'
        )
      }
      if (plan.requiredDecisions.length) {
        throw new Error(
          'Statement has ambiguous existing candidates that require reviewed decisions'
        )
      }
      const sourceNamespace = statementSourceNamespace(file.name)
      const now = new Date().toISOString()
      const balanceDelta = plannedBalanceDelta(plan)
      let runningBalance = plan.accountBalance
      let imported = 0
      let skipped = 0
      for (const row of plan.rows) {
        if (row.action === 'skip' || row.action === 'keep_existing') {
          skipped++
        } else {
          const transactionId = generateId()
          const rowDelta =
            row.transaction.type === 'income' ? row.amountCentavos : -row.amountCentavos
          const rowBalanceDelta = plan.importTreatment.ledgerTreatment === 'normal' ? rowDelta : 0
          const previousBalance = runningBalance
          runningBalance += rowBalanceDelta
          await tx.execute(
            `INSERT INTO transactions (
               id, account_id, category_id, type, amount, currency, description, notes, date,
               status, ledger_treatment, staging_batch_id,
               import_source, import_external_id, import_fingerprint, import_content_fingerprint,
               created_at, updated_at
             ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              transactionId,
              accountId,
              row.transaction.type,
              row.amountCentavos,
              plan.accountCurrency,
              row.transaction.description,
              row.transaction.date,
              plan.importTreatment.status,
              plan.importTreatment.ledgerTreatment,
              plan.importTreatment.stagingBatchId,
              sourceNamespace,
              row.transaction.externalId ?? null,
              row.importFingerprint,
              row.contentFingerprint,
              now,
              now,
            ]
          )
          await writeImportAudit(tx, {
            entity: 'transaction',
            entityId: transactionId,
            action: 'create',
            before: null,
            after: {
              transaction: {
                id: transactionId,
                accountId,
                categoryId: null,
                type: row.transaction.type,
                amountCentavos: row.amountCentavos,
                currency: plan.accountCurrency,
                description: row.transaction.description,
                notes: null,
                date: row.transaction.date,
                status: plan.importTreatment.status,
                source: null,
                ledgerTreatment: plan.importTreatment.ledgerTreatment,
                stagingBatchId: plan.importTreatment.stagingBatchId,
                reportingTreatment: 'normal',
                transactionKind: 'standard',
                importSource: sourceNamespace,
                importExternalId: row.transaction.externalId ?? null,
                importFingerprint: row.importFingerprint,
                importContentFingerprint: row.contentFingerprint,
              },
              balance: {
                accountId,
                previousBalanceCentavos: previousBalance,
                newBalanceCentavos: runningBalance,
                deltaCentavos: rowBalanceDelta,
              },
            },
            source: 'statement-import',
            note: 'Created during atomic statement import',
            createdAt: now,
          })
          imported++
        }
        for (const reviewedDecision of row.decisions ?? []) {
          if (
            !(options.decisions ?? []).some(
              (decision) =>
                decision.candidateIdentityKey === reviewedDecision.candidateIdentityKey &&
                decision.candidateContentFingerprint ===
                  reviewedDecision.candidateContentFingerprint &&
                decision.existingTransactionId === reviewedDecision.existingTransactionId &&
                decision.existingEvidenceFingerprint ===
                  reviewedDecision.existingEvidenceFingerprint &&
                decision.decision === reviewedDecision.decision
            )
          ) {
            continue
          }
          const alreadyStored = (
            await tx.query<{ id: string }>(
              `SELECT id FROM duplicate_review_decisions
               WHERE account_id=? AND candidate_identity_key=? AND candidate_content_fingerprint=?
                 AND existing_transaction_id=? AND existing_evidence_fingerprint=? AND decision=?
               LIMIT 1`,
              [
                accountId,
                reviewedDecision.candidateIdentityKey,
                reviewedDecision.candidateContentFingerprint,
                reviewedDecision.existingTransactionId,
                reviewedDecision.existingEvidenceFingerprint,
                reviewedDecision.decision,
              ]
            )
          )[0]
          if (alreadyStored) continue
          const decisionId = generateId()
          const decisionSource = 'statement-import'
          const decisionNote = 'Reviewed during atomic statement import'
          await tx.execute(
            `INSERT INTO duplicate_review_decisions (
               id, account_id, existing_transaction_id, candidate_identity_key,
               candidate_content_fingerprint, existing_evidence_fingerprint, decision, source, note
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              decisionId,
              accountId,
              reviewedDecision.existingTransactionId,
              reviewedDecision.candidateIdentityKey,
              reviewedDecision.candidateContentFingerprint,
              reviewedDecision.existingEvidenceFingerprint,
              reviewedDecision.decision,
              decisionSource,
              decisionNote,
            ]
          )
          await writeImportAudit(tx, {
            entity: 'duplicate_review_decision',
            entityId: decisionId,
            action: 'review-import-duplicate',
            before: null,
            after: {
              id: decisionId,
              accountId,
              ...reviewedDecision,
              source: decisionSource,
              note: decisionNote,
            },
            source: decisionSource,
            note: decisionNote,
            createdAt: now,
          })
        }
      }
      if (imported && plan.importTreatment.ledgerTreatment === 'normal') {
        const update = await tx.execute(
          "UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND is_archived = 0 AND COALESCE(account_mode, 'transactional') = 'transactional'",
          [balanceDelta, now, accountId]
        )
        if (update.rowsAffected !== 1)
          throw new Error(`account update affected ${update.rowsAffected} rows`)
      }
      return { imported, skipped }
    })
    await Promise.allSettled([
      Promise.resolve().then(() => useTransactionStore.getState().fetch()),
      Promise.resolve().then(() => useAccountStore.getState().fetch()),
    ])
    return {
      ...counts,
      errors: [],
      mode: options.previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
    }
  } catch (error) {
    return {
      imported: 0,
      skipped: 0,
      errors: [getErrorMessage(error)],
      mode: options.previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
    }
  }
}
