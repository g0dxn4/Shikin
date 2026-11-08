import { readFile } from 'node:fs/promises'
import {
  z,
  query,
  toCentavos,
  boundedText,
  resolveAccountId,
  normalizeCurrencyCode,
  type ToolDefinition,
} from './shared.js'
import { addTransactionInputSchema, prepareAddTransaction } from '../transaction-mutations.js'
import { executeAtomicImport, type AtomicImportRow } from '../import-transactions.js'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
import { findTransactionDuplicate, type TransactionDuplicateMatch } from '../duplicate-detection.js'

type CsvRow = {
  lineNumber: number
  fields: string[]
}

type ParsedCsv = {
  rows: CsvRow[]
  errors: Array<{ lineNumber: number; message: string }>
}

type ImportTransactionInput = {
  amount: number
  type: 'expense' | 'income'
  description: string
  date: string
  accountId: string
  category?: string
  notes?: string
  status?: 'pending' | 'posted' | 'cleared'
  source?: string
  note?: string
  ledgerTreatment?: 'normal' | 'staged_no_balance_impact'
  reportingTreatment?: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  dryRun: boolean
}

type ImportDuplicateMatch =
  | { kind: 'duplicate'; id: string; matchType: 'external_id'; externalId: string }
  | {
      kind: 'exact_duplicate' | 'potential_duplicate'
      id: string
      match: TransactionDuplicateMatch
    }
  | null

type ImportTransactionsExecutionInput = {
  file: string
  accountId?: string
  account?: string
  apply: boolean
  dryRun: boolean
  allowDuplicate: boolean
  source: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  previewToken?: string
  decisions?: ImportReviewDecision[]
}

type ResolvedImportAccount = {
  id: string
  currency: string
}

type ImportValidationIssue = {
  row: number | null
  lineNumber: number | null
  messages: string[]
}

type ImportRowOutput = Record<string, unknown>

type CsvImportPlan = {
  dataRows: CsvRow[]
  headers: string[]
  unsupportedHeaders: string[]
  errors: ImportValidationIssue[]
  previewRows: ImportRowOutput[]
  atomicRows: AtomicImportRow[]
}

type CsvImportPlanResult =
  | { kind: 'empty' }
  | {
      kind: 'plan'
      plan: CsvImportPlan
    }

type ImportRowPlan = {
  row: ImportRowOutput
  error?: ImportValidationIssue
  atomicRow?: AtomicImportRow
}

const REQUIRED_IMPORT_COLUMNS = ['date', 'description', 'amount'] as const

const OPTIONAL_IMPORT_COLUMNS = [
  'type',
  'category',
  'notes',
  'status',
  'currency',
  'source',
  'note',
  'externalid',
] as const

const SUPPORTED_IMPORT_COLUMNS = new Set<string>([
  ...REQUIRED_IMPORT_COLUMNS,
  ...OPTIONAL_IMPORT_COLUMNS,
])

function parseCsv(text: string): ParsedCsv {
  const rows: CsvRow[] = []
  const errors: Array<{ lineNumber: number; message: string }> = []
  let field = ''
  let fields: string[] = []
  let inQuotes = false
  let lineNumber = 1
  let rowStartLine = 1
  const source = text.replace(/^\uFEFF/, '')

  const pushField = () => {
    fields.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (!(fields.length === 1 && fields[0].trim() === '')) {
      rows.push({ lineNumber: rowStartLine, fields })
    }
    fields = []
    rowStartLine = lineNumber + 1
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        field += '"'
        index++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      pushField()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      pushRow()
      if (char === '\r' && source[index + 1] === '\n') index++
      lineNumber++
      rowStartLine = lineNumber
      continue
    }

    if (char === '\n') lineNumber++
    field += char
  }

  if (inQuotes) errors.push({ lineNumber: rowStartLine, message: 'Unclosed quoted CSV field.' })
  if (field.length > 0 || fields.length > 0) pushRow()

  return { rows, errors }
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
}

function parseMoneyCell(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const isParenthesizedNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const unsigned = isParenthesizedNegative ? trimmed.slice(1, -1) : trimmed
  const token = unsigned.replace(/[$€£¥\s]/g, '')
  const lastComma = token.lastIndexOf(',')
  const lastDot = token.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null
  let normalized = token

  if (lastComma !== -1 && lastDot !== -1 && decimalSeparator) {
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = token.split(thousandsSeparator).join('').replace(decimalSeparator, '.')
  } else if (decimalSeparator) {
    const separatorIndex = decimalSeparator === ',' ? lastComma : lastDot
    const decimals = token.length - separatorIndex - 1
    const looksLikeThousands = decimals === 3 && /^-?\d{1,3}([,.]\d{3})+$/.test(token)
    normalized = looksLikeThousands
      ? token.split(decimalSeparator).join('')
      : token.replace(decimalSeparator, '.')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isParenthesizedNegative ? -parsed : parsed
}

function normalizeOptionalCell(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function buildImportRowInput({
  row,
  headers,
  accountId,
  accountCurrency,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
}: {
  row: CsvRow
  headers: string[]
  accountId: string
  accountCurrency: string
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
}):
  | { success: true; input: ImportTransactionInput; externalId: string | null }
  | { success: false; errors: string[] } {
  const errors: string[] = []
  const values = Object.fromEntries(
    headers.map((header, index) => [header, row.fields[index] ?? ''])
  )

  for (const requiredColumn of REQUIRED_IMPORT_COLUMNS) {
    if (!values[requiredColumn]?.trim())
      errors.push(`Missing required column value: ${requiredColumn}.`)
  }
  if (row.fields.length > headers.length) {
    errors.push(`Row has ${row.fields.length} cells but header has ${headers.length}.`)
  }

  const amount = parseMoneyCell(values.amount ?? '')
  if (amount === null) errors.push('amount must be a finite number.')
  if (amount === 0) errors.push('amount must be non-zero.')

  const rawType = normalizeOptionalCell(values.type)?.toLowerCase()
  let type: 'expense' | 'income' | null = null
  if (rawType) {
    if (rawType === 'expense' || rawType === 'income') {
      type = rawType
    } else {
      errors.push('type must be expense or income when provided.')
    }
  } else if (amount !== null) {
    type = amount < 0 ? 'expense' : 'income'
  }

  const rawStatus = normalizeOptionalCell(values.status)?.toLowerCase()
  const status = rawStatus as 'pending' | 'posted' | 'cleared' | undefined
  if (rawStatus && !['pending', 'posted', 'cleared'].includes(rawStatus)) {
    errors.push('status must be pending, posted, or cleared when provided.')
  }

  const rowCurrency = normalizeOptionalCell(values.currency)
  if (
    rowCurrency &&
    normalizeCurrencyCode(rowCurrency) !== normalizeCurrencyCode(accountCurrency)
  ) {
    errors.push(`currency ${rowCurrency} does not match account currency ${accountCurrency}.`)
  }

  if (errors.length > 0 || amount === null || type === null) return { success: false, errors }

  const externalId =
    values.externalid === undefined || values.externalid.length === 0 ? null : values.externalid
  const noteParts = [normalizeOptionalCell(values.note)].filter((value): value is string =>
    Boolean(value)
  )
  const input: ImportTransactionInput = {
    amount: Math.abs(amount),
    type,
    description: values.description.trim(),
    date: values.date.trim(),
    accountId,
    dryRun: true,
    ledgerTreatment,
    reportingTreatment,
  }
  if (stagingBatchId) input.stagingBatchId = stagingBatchId
  const category = normalizeOptionalCell(values.category)
  const notes = normalizeOptionalCell(values.notes)
  const source = normalizeOptionalCell(values.source) ?? defaultSource
  const note = noteParts.join('; ')

  if (category) input.category = category
  if (notes) input.notes = notes
  if (status) input.status = status
  if (source) input.source = source
  if (note) input.note = note

  return { success: true, input, externalId }
}

function extractExternalIds(note: string | null | undefined): string[] {
  if (!note) return []

  return note
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('externalId='))
    .map((part) => part.slice('externalId='.length).trim())
    .filter(Boolean)
}

function findDuplicateImportTransaction(
  input: ImportTransactionInput,
  externalId: string | null
): ImportDuplicateMatch {
  if (externalId) {
    const rows =
      query<{ id: string; note: string | null }>(
        `SELECT id, note FROM transactions
         WHERE account_id = $1
           AND instr(COALESCE(note, ''), $2) > 0
         ORDER BY date DESC, created_at DESC, id DESC`,
        [input.accountId, 'externalId=']
      ) ?? []
    const exactExternalIdMatch = rows.find((row) =>
      extractExternalIds(row.note).includes(externalId)
    )
    if (exactExternalIdMatch) {
      return {
        kind: 'duplicate',
        id: exactExternalIdMatch.id,
        matchType: 'external_id',
        externalId,
      }
    }
  }

  const duplicateCheck = findTransactionDuplicate({
    accountId: input.accountId,
    date: input.date,
    amountCentavos: toCentavos(input.amount),
    type: input.type,
    status: input.status,
    description: input.description,
    source: input.source,
    note: input.note,
  })
  return duplicateCheck.match
    ? {
        kind: duplicateCheck.match.kind,
        id: duplicateCheck.match.existingTransactionId,
        match: duplicateCheck.match,
      }
    : null
}

function importInputForOutput(input: ImportTransactionInput): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input }
  delete output.dryRun
  delete output.allowDuplicate
  return output
}

function importDuplicateDetails(duplicate: ImportDuplicateMatch): Record<string, unknown> | null {
  if (!duplicate) return null
  if (duplicate.kind === 'duplicate') {
    return {
      kind: duplicate.kind,
      matchType: duplicate.matchType,
      externalId: duplicate.externalId,
      existingTransactionId: duplicate.id,
    }
  }

  return {
    kind: duplicate.kind,
    existingTransactionId: duplicate.id,
    match: duplicate.match,
  }
}

function importDuplicateOverride(duplicate: ImportDuplicateMatch): Record<string, unknown> | null {
  const details = importDuplicateDetails(duplicate)
  if (!details) return null
  return {
    allowed: true,
    reason: 'allow_duplicate',
    duplicate: details,
  }
}

function potentialDuplicateFields(duplicate: ImportDuplicateMatch): Record<string, unknown> {
  if (duplicate?.kind !== 'potential_duplicate') return {}
  return {
    reason: 'potential_duplicate',
    potentialDuplicate: {
      existingTransactionId: duplicate.id,
      match: duplicate.match,
    },
    message:
      'Potential matching transaction exists; row is not skipped automatically unless an externalId duplicate is found.',
  }
}

function validateImportTransactionsRequest({
  apply,
  dryRun,
  ledgerTreatment,
  stagingBatchId,
}: Pick<
  ImportTransactionsExecutionInput,
  'apply' | 'dryRun' | 'ledgerTreatment' | 'stagingBatchId'
>) {
  if (apply && dryRun) {
    return {
      success: false as const,
      reason: 'import_flag_conflict',
      message: 'Use either apply or dryRun, not both.',
    }
  }

  if (ledgerTreatment === 'staged_no_balance_impact' && !stagingBatchId) {
    return {
      success: false as const,
      reason: 'staging_batch_required',
      message: 'stagingBatchId is required when importing staged statement history.',
    }
  }

  return null
}

function importSupportedColumns() {
  return {
    required: [...REQUIRED_IMPORT_COLUMNS],
    optional: ['type', 'category', 'notes', 'status', 'currency', 'source', 'note', 'externalId'],
  }
}

function importAccountOutput(account: ResolvedImportAccount) {
  return { id: account.id, currency: account.currency }
}

async function readCsvImportFile(
  file: string
): Promise<{ success: true; text: string } | { success: false; result: Record<string, unknown> }> {
  try {
    return { success: true, text: await readFile(file, 'utf8') }
  } catch (error) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'csv_file_read_failed',
        file,
        message: `Could not read CSV file "${file}".`,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function createCsvImportPlan(text: string): CsvImportPlanResult {
  const parsedCsv = parseCsv(text)
  if (parsedCsv.rows.length === 0) return { kind: 'empty' }

  const [headerRow, ...dataRows] = parsedCsv.rows
  const headers = headerRow.fields.map(normalizeHeader)
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index)
  const missingRequired = REQUIRED_IMPORT_COLUMNS.filter((column) => !headers.includes(column))
  const unsupportedHeaders = headers.filter(
    (header) => header && !SUPPORTED_IMPORT_COLUMNS.has(header)
  )
  const errors: ImportValidationIssue[] = parsedCsv.errors.map((error) => ({
    row: null,
    lineNumber: error.lineNumber,
    messages: [error.message],
  }))

  if (missingRequired.length > 0) {
    errors.push({
      row: null,
      lineNumber: headerRow.lineNumber,
      messages: [`Missing required CSV columns: ${missingRequired.join(', ')}.`],
    })
  }
  if (duplicateHeaders.length > 0) {
    errors.push({
      row: null,
      lineNumber: headerRow.lineNumber,
      messages: [`Duplicate CSV columns: ${[...new Set(duplicateHeaders)].join(', ')}.`],
    })
  }

  return {
    kind: 'plan',
    plan: { dataRows, headers, unsupportedHeaders, errors, previewRows: [], atomicRows: [] },
  }
}

async function planCsvImportRow({
  row,
  rowNumber,
  headers,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
}: {
  row: CsvRow
  rowNumber: number
  headers: string[]
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
}): Promise<ImportRowPlan> {
  const built = buildImportRowInput({
    row,
    headers,
    accountId: account.id,
    accountCurrency: account.currency,
    defaultSource,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
  })
  if (!built.success) {
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages: built.errors }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: built.errors,
      },
    }
  }

  const parsedInput = addTransactionInputSchema.safeParse(built.input)
  if (!parsedInput.success) {
    const messages = parsedInput.error.issues.map((issue) => issue.message)
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: messages,
      },
    }
  }

  // CSV construction narrows the shape; keep the schema's transformed field values intact.
  const validatedInput = parsedInput.data as ImportTransactionInput
  const duplicate = findDuplicateImportTransaction(validatedInput, built.externalId)
  if (duplicate && !allowDuplicate) {
    return {
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'skipped',
        reason: duplicate.kind === 'duplicate' ? 'duplicate' : duplicate.kind,
        externalId: built.externalId,
        existingTransactionId: duplicate.id,
        duplicate: importDuplicateDetails(duplicate),
        input: importInputForOutput(validatedInput),
        message:
          duplicate.kind === 'duplicate' || duplicate.kind === 'exact_duplicate'
            ? 'Matching transaction already exists; row would be skipped.'
            : 'Potential matching transaction exists; row would be skipped unless allowDuplicate is true.',
      },
    }
  }

  const prepared = prepareAddTransaction({
    ...parsedInput.data,
    dryRun: true,
    allowDuplicate,
  })
  if (!prepared.success) {
    const messages = [String(prepared.message ?? 'Row failed validation.')]
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: messages,
      },
    }
  }

  return {
    atomicRow: {
      row: rowNumber,
      lineNumber: row.lineNumber,
      externalId: built.externalId,
      input: {
        accountId: validatedInput.accountId,
        amountCentavos: prepared.amountCentavos,
        type: validatedInput.type,
        description: validatedInput.description,
        category: validatedInput.category,
        date: validatedInput.date,
        notes: validatedInput.notes,
        status: validatedInput.status,
        source: validatedInput.source,
        note: validatedInput.note,
        ledgerTreatment: validatedInput.ledgerTreatment,
        reportingTreatment: validatedInput.reportingTreatment,
        stagingBatchId: validatedInput.stagingBatchId,
      },
    },
    row: {
      row: rowNumber,
      lineNumber: row.lineNumber,
      status: 'valid',
      externalId: built.externalId,
      input: importInputForOutput(validatedInput),
      ...(allowDuplicate && duplicate
        ? {
            reason: 'duplicate_override',
            duplicateOverride: importDuplicateOverride(duplicate),
          }
        : potentialDuplicateFields(duplicate)),
      preview: prepared.preview,
    },
  }
}

async function planCsvImportRows({
  dataRows,
  headers,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
}: {
  dataRows: CsvRow[]
  headers: string[]
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
}): Promise<{
  previewRows: ImportRowOutput[]
  atomicRows: AtomicImportRow[]
  errors: ImportValidationIssue[]
}> {
  const previewRows: ImportRowOutput[] = []
  const errors: ImportValidationIssue[] = []
  const atomicRows: AtomicImportRow[] = []

  for (const [index, row] of dataRows.entries()) {
    const plannedRow = await planCsvImportRow({
      row,
      rowNumber: index + 2,
      headers,
      account,
      defaultSource,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      allowDuplicate,
    })
    previewRows.push(plannedRow.row)
    if (plannedRow.atomicRow) atomicRows.push(plannedRow.atomicRow)
    if (plannedRow.error) errors.push(plannedRow.error)
  }

  return { previewRows, atomicRows, errors }
}

async function planCsvImport({
  text,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
}: {
  text: string
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
}): Promise<CsvImportPlanResult> {
  const planResult = createCsvImportPlan(text)
  if (planResult.kind === 'empty' || planResult.plan.errors.length > 0) return planResult

  const plannedRows = await planCsvImportRows({
    dataRows: planResult.plan.dataRows,
    headers: planResult.plan.headers,
    account,
    defaultSource,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
    allowDuplicate,
  })
  planResult.plan.previewRows.push(...plannedRows.previewRows)
  planResult.plan.atomicRows.push(...plannedRows.atomicRows)
  planResult.plan.errors.push(...plannedRows.errors)
  return planResult
}

function previewImportSummary(plan: CsvImportPlan) {
  return {
    totalRows: plan.dataRows.length,
    validRows: plan.previewRows.filter((row) => row.status === 'valid').length,
    invalidRows: plan.errors.filter((error) => error.row !== null).length,
    skippedRows: plan.previewRows.filter((row) => row.status === 'skipped').length,
    importedRows: 0,
  }
}

function formatCsvValidationFailure({
  previewOnly,
  apply,
  file,
  account,
  plan,
}: {
  previewOnly: boolean
  apply: boolean
  file: string
  account: ResolvedImportAccount
  plan: CsvImportPlan
}) {
  return {
    success: false,
    reason: 'csv_validation_failed',
    dryRun: previewOnly,
    applyRequested: Boolean(apply),
    file,
    account: importAccountOutput(account),
    supportedColumns: importSupportedColumns(),
    ignoredColumns: plan.unsupportedHeaders,
    summary: previewImportSummary(plan),
    rows: plan.previewRows,
    errors: plan.errors,
    message: `CSV import has ${plan.errors.length} validation error(s). No rows were imported.`,
  }
}

export const importTransactions: ToolDefinition = {
  name: 'import-transactions',
  description:
    'Preview or apply a UTF-8 CSV import. Required columns: date, description, amount. Optional: type, category, notes, status, currency, source, note, externalId.',
  schema: z.object({
    file: boundedText('CSV file', 'Path to a UTF-8 CSV file with a header row', 4096),
    accountId: boundedText('Account ID', 'Account ID to import transactions into', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, exact account ID, or exact account name to import transactions into',
      128
    ).optional(),
    apply: z.boolean().optional().default(false).describe('Apply the import. Omit for preview.'),
    dryRun: z.boolean().optional().default(false).describe('Force preview mode without writes'),
    allowDuplicate: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Legacy compatibility flag. It never bypasses identity conflicts or candidate review.'
      ),
    previewToken: boundedText(
      'Preview token',
      'Token returned by a preview of this exact file, options, decisions, and database revision',
      128
    ).optional(),
    decisions: z
      .array(
        z.object({
          candidateIdentityKey: boundedText(
            'Candidate identity key',
            'Preview candidate identity',
            128
          ),
          candidateContentFingerprint: boundedText(
            'Candidate content fingerprint',
            'Preview candidate financial content',
            128
          ),
          existingTransactionId: boundedText(
            'Existing transaction ID',
            'Candidate existing transaction',
            128
          ),
          existingEvidenceFingerprint: boundedText(
            'Existing evidence fingerprint',
            'Bound existing evidence',
            128
          ),
          decision: z.enum(['distinct', 'keep_existing']),
        })
      )
      .optional()
      .default([]),
    source: boundedText('Source', 'Default source label for imported rows', 120)
      .optional()
      .default('csv-import'),
    ledgerTreatment: z
      .enum(['normal', 'staged_no_balance_impact'])
      .optional()
      .default('normal')
      .describe('Import incomplete history as staged rows without changing balances'),
    reportingTreatment: z
      .enum(['normal', 'exclude_from_cashflow'])
      .optional()
      .default('normal')
      .describe('Default reporting treatment for imported rows'),
    stagingBatchId: boundedText(
      'Staging batch ID',
      'Required when importing staged_no_balance_impact history',
      128
    ).optional(),
  }),
  effects: {
    writesTo: [
      'accounts',
      'transactions',
      'duplicate_review_decisions',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input: ImportTransactionsExecutionInput) => {
    const {
      file,
      accountId,
      account,
      apply,
      dryRun,
      allowDuplicate,
      source,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      previewToken,
      decisions,
    } = input
    const requestFailure = validateImportTransactionsRequest({
      apply,
      dryRun,
      ledgerTreatment,
      stagingBatchId,
    })
    if (requestFailure) return requestFailure

    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount

    const fileContents = await readCsvImportFile(file)
    if (!fileContents.success) return fileContents.result

    const planResult = await planCsvImport({
      text: fileContents.text,
      account: resolvedAccount,
      defaultSource: source,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      allowDuplicate: true,
    })
    if (planResult.kind === 'empty') {
      return {
        success: false,
        reason: 'csv_empty',
        message: 'CSV file is empty or has no header row.',
      }
    }

    const { plan } = planResult
    const previewOnly = !apply || dryRun
    if (plan.errors.length > 0) {
      return formatCsvValidationFailure({
        previewOnly,
        apply,
        file,
        account: resolvedAccount,
        plan,
      })
    }
    try {
      const atomicResult = executeAtomicImport({
        rawContent: fileContents.text,
        rows: plan.atomicRows,
        options: {
          accountId: resolvedAccount.id,
          accountCurrency: resolvedAccount.currency,
          sourceNamespace: source,
          ledgerTreatment,
          reportingTreatment,
          stagingBatchId,
        },
        decisions,
        previewToken,
        apply: !previewOnly,
      })
      return {
        ...atomicResult,
        dryRun: previewOnly,
        applyRequired: previewOnly,
        file,
        account: importAccountOutput(resolvedAccount),
        supportedColumns: importSupportedColumns(),
        ignoredColumns: plan.unsupportedHeaders,
        ...(allowDuplicate
          ? {
              warning:
                'allowDuplicate is legacy-only and did not bypass conflicts. Submit candidate-specific decisions from requiredDecisions and preview again.',
            }
          : {}),
      }
    } catch (error) {
      return {
        success: false,
        reason: previewToken ? 'import_preview_stale_or_apply_failed' : 'csv_apply_failed',
        mode: previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
        file,
        account: importAccountOutput(resolvedAccount),
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },
}
