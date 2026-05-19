#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { tools, type ToolDefinition } from './tools.js'
import { close, query } from './database.js'
import {
  findTransactionDuplicate,
  transactionDuplicateReason,
  type TransactionDuplicateCheck,
} from './duplicate-detection.js'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { toCentavos } from './money.js'
import { z } from 'zod'
import dayjs from 'dayjs'

export const EXPECTED_MIGRATIONS = CLI_DATABASE_MIGRATIONS
export const COMMAND_CATALOG_VERSION = '2026-05-07.cli-qol-followups'
export const CLI_SCHEMA_VERSION = 'cli-tools-json.v1'
export const CLI_FOUNDATION_MIGRATION = '016_cli_qol_foundation'

function isFailureResult(value: unknown): value is Record<string, unknown> & { success: false } {
  return (
    typeof value === 'object' && value !== null && 'success' in value && value.success === false
  )
}

type OutputOptions = {
  json?: boolean
  pretty?: boolean
  quiet?: boolean
  redacted?: boolean
}

type DescribedOption = ReturnType<typeof zodToOptions>[number] & {
  name: string
  type: string
  enumValues?: string[]
}

const OUTPUT_OPTION_KEYS = new Set(['json', 'pretty', 'quiet', 'redacted'])
const SENSITIVE_KEY_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key)/i

function addOutputOptions(cmd: Command, options: { includeRedacted?: boolean } = {}): Command {
  const withBaseOptions = cmd
    .option('--json', 'Print compact JSON output')
    .option('--pretty', 'Print pretty JSON output (default)')
    .option('--quiet', 'Suppress successful output; failures still print JSON')
  return options.includeRedacted === false
    ? withBaseOptions
    : withBaseOptions.option('--redacted', 'Redact future sensitive fields from output')
}

function getOutputOptions(opts: Record<string, unknown>): OutputOptions {
  return {
    json: Boolean(opts.json),
    pretty: Boolean(opts.pretty),
    quiet: Boolean(opts.quiet),
    redacted: Boolean(opts.redacted),
  }
}

function normalizeResult(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { success: true, result }
  }

  const record = result as Record<string, unknown>
  const normalized: Record<string, unknown> =
    'success' in record ? { ...record } : { success: true, ...record }

  if (normalized.success === false && typeof normalized.code !== 'string') {
    normalized.code = getFailureCode(normalized)
  }

  if (
    normalized.success === false &&
    typeof normalized.hint !== 'string' &&
    typeof normalized.message === 'string'
  ) {
    const hint = inferHint(normalized.message)
    if (hint) normalized.hint = hint
  }

  return normalized
}

function getFailureCode(result: Record<string, unknown>): string {
  for (const key of ['reason', 'errorType', 'error']) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) {
      return toErrorCode(value)
    }
  }
  return 'COMMAND_FAILED'
}

function toErrorCode(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

function inferHint(message: string): string | null {
  const lower = message.toLowerCase()
  if (lower.includes('account') && lower.includes('not found')) {
    return 'Run shikin list-accounts to find a valid account, or set an alias with shikin set-account-alias.'
  }
  if (lower.includes('category') && lower.includes('not found')) {
    return 'Run shikin suggest-category --description "..." or shikin manage-category-rules --action list.'
  }
  if (lower.includes('multiple accounts')) {
    return 'Pass --account-id or --account explicitly, or set an account alias with shikin set-account-alias.'
  }
  return null
}

function writeOutput(result: unknown, options: OutputOptions): void {
  const normalized = normalizeResult(result)
  if (options.quiet && !isFailureResult(normalized)) {
    return
  }

  const output = options.redacted ? redactSensitiveFields(normalized) : normalized
  const indent = options.json && !options.pretty ? undefined : 2
  console.log(JSON.stringify(output, null, indent))
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields)
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(nestedValue),
    ])
  )
}

function errorResult(
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    success: false,
    code,
    message,
    ...extra,
  }
  const hint = inferHint(message)
  if (hint && typeof result.hint !== 'string') result.hint = hint
  return result
}

function errorFromUnknown(err: unknown): Record<string, unknown> {
  if (err instanceof z.ZodError) {
    return errorResult('VALIDATION_ERROR', 'Validation error', { issues: err.issues })
  }

  return errorResult('COMMAND_ERROR', err instanceof Error ? err.message : String(err))
}

function describeOutputOptions(options: { includeRedacted?: boolean } = {}) {
  const outputOptions = [
    {
      name: 'json',
      flag: 'json',
      type: 'boolean',
      required: false,
      description: 'Print compact JSON output',
    },
    {
      name: 'pretty',
      flag: 'pretty',
      type: 'boolean',
      required: false,
      description: 'Print pretty JSON output',
    },
    {
      name: 'quiet',
      flag: 'quiet',
      type: 'boolean',
      required: false,
      description: 'Suppress successful output',
    },
  ]
  return options.includeRedacted === false
    ? outputOptions
    : [
        ...outputOptions,
        {
          name: 'redacted',
          flag: 'redacted',
          type: 'boolean',
          required: false,
          description: 'Redact sensitive output fields',
        },
      ]
}

function describeToolOutputOptions(schema: z.ZodObject<any>) {
  const ownsRedacted = Object.prototype.hasOwnProperty.call(schema.shape, 'redacted')
  return describeOutputOptions({ includeRedacted: !ownsRedacted })
}

function describeToolOptions(schema: z.ZodObject<any>): DescribedOption[] {
  const optionByFlag = new Map(zodToOptions(schema).map((option) => [option.flag, option]))

  return Object.entries(schema.shape).map(([name, zodType]) => {
    const flag = camelToKebab(name)
    const option = optionByFlag.get(flag)
    const inner = unwrapSchema(zodType as z.ZodTypeAny)
    const enumValues = getEnumValues(inner)
    const describedFlag =
      option?.isBoolean && option.defaultValue === true ? `no-${flag}` : (option?.flag ?? flag)

    return {
      ...(option ?? {
        flag,
        description: '',
        required: true,
        isArray: false,
        isBoolean: false,
        isStructured: false,
      }),
      flag: describedFlag,
      name,
      type: describeZodType(inner),
      ...(enumValues ? { enumValues } : {}),
    }
  })
}

function describeZodType(schema: z.ZodTypeAny): string {
  const inner = unwrapSchema(schema)

  if (inner instanceof z.ZodEnum) return 'enum'
  if (inner instanceof z.ZodNumber) return 'number'
  if (inner instanceof z.ZodBoolean) return 'boolean'
  if (inner instanceof z.ZodString) return 'string'
  if (inner instanceof z.ZodArray) return `array<${describeZodType(inner.element)}>`
  if (inner instanceof z.ZodObject) return 'object'

  return 'unknown'
}

function getEnumValues(schema: z.ZodTypeAny): string[] | undefined {
  const inner = unwrapSchema(schema)
  if (!(inner instanceof z.ZodEnum)) return undefined

  const options = (inner as any).options
  return Array.isArray(options) ? [...options] : undefined
}

function getToolAliases(tool: ToolDefinition): string[] {
  if (tool.name === 'backup-database') return ['backup']
  if (tool.name === 'restore-database') return ['restore']
  return tool.name === 'query-transactions' ? ['list-transactions'] : []
}

function getCommandCatalog(toolDefinitions: ToolDefinition[]) {
  const defaultOutputOptions = describeOutputOptions()
  const validateOutputOptions = describeOutputOptions({ includeRedacted: false })
  const cliUnavailableTools = toolDefinitions
    .filter((tool) => tool.cliUnavailableMessage)
    .map((tool) => tool.name)
    .sort()
  const mcpUnavailableTools = toolDefinitions
    .filter((tool) => tool.mcpUnavailableMessage)
    .map((tool) => tool.name)
    .sort()
  const latestRequiredMigration = CLI_DATABASE_MIGRATIONS.at(-1) ?? null
  const builtInCommands = [
    {
      name: 'diagnose',
      kind: 'builtin',
      validateable: false,
      description: 'Validate shared database connectivity and print CLI/MCP health details',
      aliases: [],
      arguments: [],
      options: [
        {
          name: 'deep',
          flag: 'deep',
          type: 'boolean',
          required: false,
          description: 'Run read-only integrity, foreign-key, migration, and balance checks',
        },
      ],
      outputOptions: defaultOutputOptions,
    },
    {
      name: 'tools',
      kind: 'builtin',
      validateable: false,
      description: 'Return machine-readable command discovery metadata',
      aliases: [],
      arguments: [],
      options: [],
      outputOptions: defaultOutputOptions,
    },
    {
      name: 'validate',
      kind: 'builtin',
      validateable: false,
      description: 'Validate another command without executing it',
      aliases: [],
      arguments: [
        { name: 'commandName', required: true },
        { name: 'args', required: false, variadic: true },
      ],
      options: [],
      outputOptions: validateOutputOptions,
    },
    {
      name: 'record',
      kind: 'builtin',
      validateable: false,
      description: 'Parse a natural-language transaction entry and return a confirmation preview',
      aliases: [],
      arguments: [{ name: 'entry', required: true, variadic: true }],
      options: [
        {
          name: 'apply',
          flag: 'apply',
          type: 'boolean',
          required: false,
          description: 'Apply the parsed transaction noninteractively',
        },
        {
          name: 'dryRun',
          flag: 'dry-run',
          type: 'boolean',
          required: false,
          description: 'Validate and preview without writing (default)',
        },
        {
          name: 'strict',
          flag: 'strict',
          type: 'boolean',
          required: false,
          description: 'Fail when natural-language parsing is ambiguous or low-confidence',
        },
        {
          name: 'minConfidence',
          flag: 'min-confidence',
          type: 'number',
          required: false,
          description: 'Minimum parse confidence from 0 to 1 before recording',
        },
        {
          name: 'requireExplicitType',
          flag: 'require-explicit-type',
          type: 'boolean',
          required: false,
          description: 'Require income or expense intent to be explicit in the entry',
        },
        {
          name: 'requireExplicitAccount',
          flag: 'require-explicit-account',
          type: 'boolean',
          required: false,
          description:
            'Require an account via --account, --account-id, or an account phrase in the entry',
        },
        {
          name: 'requireExplicitAmount',
          flag: 'require-explicit-amount',
          type: 'boolean',
          required: false,
          description: 'Require an explicit amount in the entry',
        },
        {
          name: 'allowDuplicate',
          flag: 'allow-duplicate',
          type: 'boolean',
          required: false,
          description: 'Apply even when an exact or likely duplicate transaction is detected',
        },
        {
          name: 'account',
          flag: 'account',
          type: 'string',
          required: false,
          description: 'Account alias, exact account ID, or exact account name',
        },
        {
          name: 'accountId',
          flag: 'account-id',
          type: 'string',
          required: false,
          description: 'Canonical account ID',
        },
        {
          name: 'category',
          flag: 'category',
          type: 'string',
          required: false,
          description: 'Category name override',
        },
        {
          name: 'status',
          flag: 'status',
          type: 'enum',
          required: false,
          enumValues: ['pending', 'posted', 'cleared'],
          description: 'Transaction status',
        },
        {
          name: 'notes',
          flag: 'notes',
          type: 'string',
          required: false,
          description: 'User transaction notes',
        },
        {
          name: 'source',
          flag: 'source',
          type: 'string',
          required: false,
          description: 'Automation source or origin label for transaction provenance',
        },
        {
          name: 'note',
          flag: 'note',
          type: 'string',
          required: false,
          description: 'Workflow changelog note for transaction provenance',
        },
      ],
      outputOptions: defaultOutputOptions,
    },
  ]

  const toolCommands = toolDefinitions.map((tool) => ({
    name: tool.name,
    kind: 'tool',
    validateable: true,
    validationScope: 'schema',
    description: tool.description,
    aliases: getToolAliases(tool),
    availableInCli: !tool.cliUnavailableMessage,
    availableInMcp: !tool.mcpUnavailableMessage,
    cliUnavailableMessage: tool.cliUnavailableMessage,
    mcpUnavailableMessage: tool.mcpUnavailableMessage,
    options: describeToolOptions(tool.schema),
    outputOptions: describeToolOutputOptions(tool.schema),
  }))

  const commands = [...builtInCommands, ...toolCommands]

  return {
    success: true,
    catalogVersion: COMMAND_CATALOG_VERSION,
    schemaVersion: CLI_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    compatibility: {
      localFirst: true,
      sharedCatalog: true,
      notes: [
        'Commands execute against the local Shikin SQLite database; no remote service is required.',
        'CLI and MCP surfaces are generated from the same shared tool definition catalog.',
      ],
      cli: {
        availableToolCount: toolDefinitions.length - cliUnavailableTools.length,
        unavailableToolCount: cliUnavailableTools.length,
        unavailableTools: cliUnavailableTools,
      },
      mcp: {
        availableToolCount: toolDefinitions.length - mcpUnavailableTools.length,
        unavailableToolCount: mcpUnavailableTools.length,
        unavailableTools: mcpUnavailableTools,
      },
      validation: {
        scope: 'schema',
        note: 'The validate command parses arguments against the command schema only; it does not run domain checks or write data.',
      },
    },
    database: {
      requiredMigrations: [...CLI_DATABASE_MIGRATIONS],
      latestRequiredMigration,
      migrationCount: CLI_DATABASE_MIGRATIONS.length,
      expectsCurrent016FoundationSchema: CLI_DATABASE_MIGRATIONS.includes(CLI_FOUNDATION_MIGRATION),
      foundationMigration: CLI_FOUNDATION_MIGRATION,
      readinessContract: {
        migrationsAreRequired: true,
        structuralChecksRunAtDatabaseOpen: true,
        optionalSupportSurfacesDegradeWhenTablesOrColumnsAreMissing: true,
      },
      supportSchema: {
        goals: {
          table: 'goals',
          columns: [
            'id',
            'name',
            'target_amount',
            'current_amount',
            'deadline',
            'account_id',
            'icon',
            'color',
            'notes',
            'created_at',
            'updated_at',
          ],
          requiredForCatalog: false,
        },
        investments: {
          table: 'investments',
          columns: [
            'id',
            'account_id',
            'symbol',
            'name',
            'type',
            'shares',
            'avg_cost_basis',
            'currency',
            'notes',
            'created_at',
            'updated_at',
          ],
          requiredForCatalog: false,
        },
        stockPrices: {
          table: 'stock_prices',
          columns: ['id', 'symbol', 'price', 'currency', 'date', 'created_at'],
          requiredForCatalog: false,
        },
      },
    },
    commandCount: commands.length,
    toolCount: toolDefinitions.length,
    outputOptions: defaultOutputOptions,
    commands,
  }
}

function parseValidateArgs(args: string[], tool: ToolDefinition): Record<string, unknown> {
  const options = describeToolOptions(tool.schema)
  const optionByFlag = new Map(options.map((option) => [option.flag, option]))
  const input: Record<string, unknown> = {}

  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${token}". Use --option value pairs.`)
    }

    const inlineValueIndex = token.indexOf('=')
    const rawFlag = token.slice(2, inlineValueIndex === -1 ? undefined : inlineValueIndex)
    const inlineValue = inlineValueIndex === -1 ? undefined : token.slice(inlineValueIndex + 1)
    const negated = rawFlag.startsWith('no-')
    const baseFlag = negated ? rawFlag.slice(3) : rawFlag

    const option = optionByFlag.get(rawFlag)
    if (OUTPUT_OPTION_KEYS.has(kebabToCamel(baseFlag)) && !option) {
      continue
    }

    if (!option) {
      throw new Error(`Unknown option --${rawFlag} for ${tool.name}.`)
    }
    const optionFlag = option.flag.startsWith('no-') ? option.flag.slice(3) : option.flag

    if (negated && !option.isBoolean) {
      throw new Error(`--no-${optionFlag} is only valid for boolean options.`)
    }

    if (option.isBoolean) {
      const next = args[index + 1]
      if (negated) {
        input[option.name] = false
      } else if (inlineValue !== undefined) {
        input[option.name] = inlineValue
      } else if (
        option.defaultValue === undefined &&
        typeof next === 'string' &&
        !next.startsWith('--') &&
        ['true', 'false'].includes(next.trim().toLowerCase())
      ) {
        input[option.name] = next
        index++
      } else {
        input[option.name] = true
      }
      continue
    }

    if (inlineValue !== undefined) {
      input[option.name] = inlineValue
      continue
    }

    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${optionFlag}.`)
    }

    input[option.name] = next
    index++
  }

  return input
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function camelToKebab(value: string): string {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase()
}

function validateToolInput(commandName: string, args: string[], toolDefinitions: ToolDefinition[]) {
  const tool = toolDefinitions.find(
    (candidate) => candidate.name === commandName || getToolAliases(candidate).includes(commandName)
  )

  if (!tool) {
    return errorResult('UNKNOWN_COMMAND', `Command ${commandName} was not found.`, {
      hint: 'Run shikin tools --pretty to list available commands.',
    })
  }

  try {
    const rawInput = parseValidateArgs(args, tool)
    const coercedInput = coerceInput(rawInput, tool.schema)
    const parsed = tool.schema.safeParse(coercedInput)

    if (!parsed.success) {
      return errorResult('VALIDATION_ERROR', 'Validation error', { issues: parsed.error.issues })
    }

    return {
      success: true,
      command: tool.name,
      validationScope: 'schema',
      input: parsed.data,
      message: `${tool.name} input is schema-valid. No domain checks ran and no changes were made.`,
    }
  } catch (err) {
    return errorFromUnknown(err)
  }
}

type RecordTransactionType = 'expense' | 'income'

type TextSpan = {
  start: number
  end: number
}

type RecordParseWarning = {
  type: string
  message: string
}

type RecordAmountCandidate = TextSpan & {
  amount: number
  currency: string | null
  token: string
  selected: boolean
}

type RecordTypeCandidate = {
  type: RecordTransactionType
  term: string
  selected: boolean
}

type RecordDateCandidate = TextSpan & {
  date: string
  source: string
  kind: 'relative' | 'iso' | 'month_day' | 'date_range' | 'default_today'
  selected: boolean
  rangeEndDate?: string
}

type RecordTextCandidate = TextSpan & {
  value: string
  selected: boolean
}

type ParsedRecordEntry = {
  raw: string
  amount: number | null
  currency: string | null
  type: RecordTransactionType
  description: string | null
  category: string | null
  account: string | null
  date: string
  confidence: number
  confidenceLabel: 'low' | 'medium' | 'high'
  parseWarnings: RecordParseWarning[]
  ambiguityReasons: string[]
  candidates: {
    amounts: RecordAmountCandidate[]
    types: RecordTypeCandidate[]
    dates: RecordDateCandidate[]
    categories: RecordTextCandidate[]
    accounts: RecordTextCandidate[]
  }
  explicit: {
    amount: boolean
    type: boolean
    date: boolean
    category: boolean
    account: boolean
  }
}

const RECORD_AMOUNT_PATTERN =
  /(-?(?:\d{1,3}(?:[,.]\d{3})+(?:[,.]\d{1,2})?|\d+(?:[,.]\d{1,2})?))\s*([A-Z]{3})?\b/g

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

function parseRecordEntry(entry: string): ParsedRecordEntry {
  const dateCandidates = findRecordDateCandidates(entry)
  const explicitDateCandidates = dateCandidates.filter(
    (candidate) => candidate.kind !== 'default_today'
  )
  const nonAmountSpans = [...findUrlSpans(entry), ...explicitDateCandidates]
  const amountCandidates = findRecordAmountCandidates(entry, nonAmountSpans)
  const selectedAmount = amountCandidates[0] ?? null
  const typeCandidates = findRecordTypeCandidates(entry)
  const selectedType = chooseRecordType(typeCandidates)
  const categoryCandidates = findRecordTextCandidates(
    entry,
    /\b(?:category|categoria)\s+(.+?)(?=\s+(?:account|cuenta|today|yesterday|tomorrow|hoy|ayer|manana|category|categoria)\b|$)/gi
  )
  const accountCandidates = findRecordTextCandidates(
    entry,
    /\b(?:account|cuenta)\s+(.+?)(?=\s+(?:category|categoria|today|yesterday|tomorrow|hoy|ayer|manana)\b|$)/gi
  )
  const selectedCategory = categoryCandidates[0] ?? null
  const selectedAccount = accountCandidates[0] ?? null
  const selectedDate = dateCandidates[0]
  const parseWarnings = buildRecordParseWarnings({
    amountCandidates,
    typeCandidates,
    explicitDateCandidates,
    selectedAmount,
  })
  const ambiguityReasons = buildRecordAmbiguityReasons(parseWarnings)
  const description = buildRecordDescription(entry, [
    ...(selectedAmount ? [selectedAmount] : []),
    ...(selectedCategory ? [selectedCategory] : []),
    ...(selectedAccount ? [selectedAccount] : []),
    ...explicitDateCandidates,
  ])
  const confidence = calculateRecordParseConfidence({
    amount: selectedAmount?.amount ?? null,
    currency: selectedAmount?.currency ?? null,
    description,
    typeCandidates,
    selectedCategory,
    selectedAccount,
    selectedDate,
    parseWarnings,
  })

  return {
    raw: entry,
    amount: selectedAmount?.amount ?? null,
    currency: selectedAmount?.currency ?? null,
    type: selectedType,
    description,
    category: selectedCategory?.value ?? null,
    account: selectedAccount?.value ?? null,
    date: selectedDate.date,
    confidence,
    confidenceLabel: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
    parseWarnings,
    ambiguityReasons,
    candidates: {
      amounts: amountCandidates.map((candidate, index) => ({
        ...candidate,
        selected: index === 0,
      })),
      types: typeCandidates.map((candidate) => ({
        ...candidate,
        selected: candidate.type === selectedType && hasSingleRecordType(typeCandidates),
      })),
      dates: dateCandidates.map((candidate, index) => ({ ...candidate, selected: index === 0 })),
      categories: categoryCandidates.map((candidate, index) => ({
        ...candidate,
        selected: index === 0,
      })),
      accounts: accountCandidates.map((candidate, index) => ({
        ...candidate,
        selected: index === 0,
      })),
    },
    explicit: {
      amount: selectedAmount !== null,
      type: hasSingleRecordType(typeCandidates),
      date: selectedDate.kind !== 'default_today',
      category: selectedCategory !== null,
      account: selectedAccount !== null,
    },
  }
}

function findRecordAmountCandidates(
  entry: string,
  excludedSpans: TextSpan[]
): RecordAmountCandidate[] {
  return Array.from(entry.matchAll(RECORD_AMOUNT_PATTERN))
    .map((match): RecordAmountCandidate | null => {
      const token = match[1]
      const amount = parseAmountToken(token)
      if (amount === null) return null

      const start = match.index ?? 0
      const end = (match.index ?? 0) + match[0].length
      const span = { start, end }
      const previous = start > 0 ? entry[start - 1] : ''
      if (previous && /[\w/.-]/.test(previous)) return null
      if (excludedSpans.some((excluded) => spansOverlap(span, excluded))) return null

      return {
        ...span,
        amount,
        currency: match[2] ? match[2].toUpperCase() : null,
        token,
        selected: false,
      }
    })
    .filter((candidate): candidate is RecordAmountCandidate => candidate !== null)
}

function findRecordTypeCandidates(entry: string): RecordTypeCandidate[] {
  const normalized = normalizeRecordText(entry)
  const patterns: Array<{ type: RecordTransactionType; term: string; pattern: RegExp }> = [
    { type: 'income', term: 'pago de anticipo', pattern: /\bpago\s+de\s+anticipo\b/ },
    { type: 'income', term: 'me pagaron', pattern: /\bme\s+pagaron\b/ },
    {
      type: 'income',
      term: 'income',
      pattern:
        /\b(income|salary|paycheck|deposit|deposited|earned|received|ingreso|ingrese|deposite|anticipo)\b/,
    },
    {
      type: 'expense',
      term: 'expense',
      pattern: /\b(expense|spent|paid|bought|purchase|charge|charged|pague|compre|gaste)\b/,
    },
  ]

  return patterns.flatMap(({ type, term, pattern }) =>
    Array.from(normalized.matchAll(new RegExp(pattern, 'g'))).map((match) => ({
      type,
      term: match[0] || term,
      selected: false,
    }))
  )
}

function chooseRecordType(candidates: RecordTypeCandidate[]): RecordTransactionType {
  const uniqueTypes = uniqueRecordTypes(candidates)
  return uniqueTypes.length === 1 ? uniqueTypes[0] : 'expense'
}

function hasSingleRecordType(candidates: RecordTypeCandidate[]): boolean {
  return uniqueRecordTypes(candidates).length === 1
}

function uniqueRecordTypes(candidates: RecordTypeCandidate[]): RecordTransactionType[] {
  return Array.from(new Set(candidates.map((candidate) => candidate.type)))
}

function findRecordDateCandidates(entry: string): RecordDateCandidate[] {
  const candidates: RecordDateCandidate[] = []
  const pushCandidate = (candidate: Omit<RecordDateCandidate, 'selected'>) => {
    if (!candidates.some((existing) => spansOverlap(existing, candidate))) {
      candidates.push({ ...candidate, selected: false })
    }
  }

  for (const match of entry.matchAll(/\b(today|hoy)\b/gi)) {
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date: relativeIsoDate(0),
      source: match[0],
      kind: 'relative',
    })
  }
  for (const match of entry.matchAll(/\b(yesterday|ayer)\b/gi)) {
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date: relativeIsoDate(-1),
      source: match[0],
      kind: 'relative',
    })
  }
  for (const match of entry.matchAll(/\b(tomorrow|manana)\b/gi)) {
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date: relativeIsoDate(1),
      source: match[0],
      kind: 'relative',
    })
  }
  for (const match of entry.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const date = normalizeRecordDate(Number(match[1]), Number(match[2]), Number(match[3]))
    if (!date) continue
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date,
      source: match[0],
      kind: 'iso',
    })
  }
  for (const match of entry.matchAll(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:\s*[-]\s*(\d{1,2}))?\b/gi
  )) {
    const month = MONTHS[match[1].toLowerCase()]
    const startDate = normalizeRecordDate(dayjs().year(), month, Number(match[2]))
    if (!startDate) continue
    const rangeEndDate = match[3]
      ? normalizeRecordDate(dayjs().year(), month, Number(match[3]))
      : null
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date: startDate,
      source: match[0],
      kind: rangeEndDate ? 'date_range' : 'month_day',
      ...(rangeEndDate ? { rangeEndDate } : {}),
    })
  }
  for (const match of entry.matchAll(
    /\b(\d{1,2})(?:\s*(?:al|-)\s*(\d{1,2}))?\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gi
  )) {
    const month = MONTHS[match[3].toLowerCase()]
    const startDate = normalizeRecordDate(dayjs().year(), month, Number(match[1]))
    if (!startDate) continue
    const rangeEndDate = match[2]
      ? normalizeRecordDate(dayjs().year(), month, Number(match[2]))
      : null
    pushCandidate({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      date: startDate,
      source: match[0],
      kind: rangeEndDate ? 'date_range' : 'month_day',
      ...(rangeEndDate ? { rangeEndDate } : {}),
    })
  }

  if (candidates.length === 0) {
    candidates.push({
      start: 0,
      end: 0,
      date: relativeIsoDate(0),
      source: 'default',
      kind: 'default_today',
      selected: false,
    })
  }

  return candidates
}

function findRecordTextCandidates(entry: string, pattern: RegExp): RecordTextCandidate[] {
  return Array.from(entry.matchAll(pattern))
    .map((match) => {
      const value = match[1]?.trim()
      if (!value) return null
      return {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        value,
        selected: false,
      }
    })
    .filter((candidate): candidate is RecordTextCandidate => candidate !== null)
}

function buildRecordParseWarnings(input: {
  amountCandidates: RecordAmountCandidate[]
  typeCandidates: RecordTypeCandidate[]
  explicitDateCandidates: RecordDateCandidate[]
  selectedAmount: RecordAmountCandidate | null
}): RecordParseWarning[] {
  const warnings: RecordParseWarning[] = []

  if (!input.selectedAmount) {
    warnings.push({ type: 'amount_missing', message: 'No explicit transaction amount was found.' })
  } else if (input.amountCandidates.length > 1) {
    warnings.push({
      type: 'multiple_amounts',
      message: 'Multiple possible amounts were found; the first amount was selected.',
    })
  }

  const typeCount = uniqueRecordTypes(input.typeCandidates).length
  if (typeCount === 0) {
    warnings.push({
      type: 'type_defaulted_to_expense',
      message: 'No explicit income or expense intent was found; expense was selected by default.',
    })
  } else if (typeCount > 1) {
    warnings.push({
      type: 'multiple_types',
      message: 'Both income and expense intent were detected; expense was selected by default.',
    })
  }

  const dateRanges = input.explicitDateCandidates.filter(
    (candidate) => candidate.kind === 'date_range'
  )
  if (dateRanges.length > 0) {
    warnings.push({
      type: 'date_range_ambiguous',
      message: 'A date range was found; the first date in the range was selected.',
    })
  }
  if (input.explicitDateCandidates.length > 1) {
    warnings.push({
      type: 'multiple_dates',
      message: 'Multiple possible dates were found; the first date was selected.',
    })
  }
  if (input.explicitDateCandidates.length === 0) {
    warnings.push({
      type: 'date_defaulted_to_today',
      message: 'No explicit date was found; today was selected by default.',
    })
  }

  return warnings
}

function buildRecordAmbiguityReasons(warnings: RecordParseWarning[]): string[] {
  return warnings
    .map((warning) => warning.type)
    .filter((type) =>
      [
        'amount_missing',
        'multiple_amounts',
        'multiple_types',
        'date_range_ambiguous',
        'multiple_dates',
      ].includes(type)
    )
}

function calculateRecordParseConfidence(input: {
  amount: number | null
  currency: string | null
  description: string | null
  typeCandidates: RecordTypeCandidate[]
  selectedCategory: RecordTextCandidate | null
  selectedAccount: RecordTextCandidate | null
  selectedDate: RecordDateCandidate
  parseWarnings: RecordParseWarning[]
}): number {
  let score = 0
  if (input.amount !== null) score += 0.35
  if (input.description) score += 0.2
  if (hasSingleRecordType(input.typeCandidates)) score += 0.15
  else if (input.typeCandidates.length === 0) score += 0.05
  if (input.selectedDate.kind !== 'default_today') score += 0.1
  else score += 0.05
  if (input.selectedCategory) score += 0.05
  if (input.selectedAccount) score += 0.05
  if (input.currency) score += 0.05
  if (input.parseWarnings.some((warning) => warning.type === 'multiple_amounts')) score -= 0.15
  if (input.parseWarnings.some((warning) => warning.type === 'multiple_types')) score -= 0.15
  if (input.parseWarnings.some((warning) => warning.type === 'date_range_ambiguous')) score -= 0.1
  if (input.parseWarnings.some((warning) => warning.type === 'amount_missing')) score -= 0.35
  if (!input.description) score -= 0.15

  return Math.max(0, Math.min(1, Number(score.toFixed(2))))
}

function buildRecordDescription(entry: string, spans: TextSpan[]): string | null {
  const description = removeRecordSpans(entry, spans)
    .replace(/\b(?:today|yesterday|tomorrow|hoy|ayer|manana)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return description || null
}

function removeRecordSpans(value: string, spans: TextSpan[]): string {
  return spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => right.start - left.start)
    .reduce((result, span) => `${result.slice(0, span.start)} ${result.slice(span.end)}`, value)
}

function findUrlSpans(entry: string): TextSpan[] {
  return Array.from(entry.matchAll(/\b(?:https?:\/\/|www\.)\S+/gi)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

function spansOverlap(left: TextSpan, right: TextSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function normalizeRecordText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function normalizeRecordDate(year: number, month: number, day: number): string | null {
  const date = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  if (
    !date.isValid() ||
    date.year() !== year ||
    date.month() + 1 !== month ||
    date.date() !== day
  ) {
    return null
  }
  return date.format('YYYY-MM-DD')
}

function relativeIsoDate(offsetDays: number): string {
  return dayjs().add(offsetDays, 'day').format('YYYY-MM-DD')
}

function parseAmountToken(value: string): number | null {
  const token = value.trim()
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

  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

const RECORD_STATUSES = new Set(['pending', 'posted', 'cleared'])

type RecordParsePolicy = {
  strict: boolean
  minConfidence: number
  minConfidenceProvided: boolean
  requireExplicitType: boolean
  requireExplicitAccount: boolean
  requireExplicitAmount: boolean
}

function getRecordParsePolicy(
  options: Record<string, unknown>
):
  | { success: true; policy: RecordParsePolicy }
  | { success: false; result: Record<string, unknown> } {
  const strict = Boolean(options.strict)
  const minConfidenceProvided =
    options.minConfidence !== undefined && options.minConfidence !== null
  const minConfidence = minConfidenceProvided ? Number(options.minConfidence) : strict ? 0.75 : 0

  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    return {
      success: false,
      result: errorResult('VALIDATION_ERROR', 'Validation error', {
        issues: [
          {
            path: ['minConfidence'],
            message: 'Minimum confidence must be a number from 0 to 1.',
          },
        ],
      }),
    }
  }

  return {
    success: true,
    policy: {
      strict,
      minConfidence,
      minConfidenceProvided,
      requireExplicitType: Boolean(options.requireExplicitType),
      requireExplicitAccount: Boolean(options.requireExplicitAccount),
      requireExplicitAmount: Boolean(options.requireExplicitAmount),
    },
  }
}

function getRecordStrictAmbiguityReasons(
  parsed: ParsedRecordEntry,
  options: Record<string, unknown>,
  policy: RecordParsePolicy
): string[] {
  const reasons = new Set<string>()

  if (policy.strict) {
    for (const reason of parsed.ambiguityReasons) reasons.add(reason)
    if (parsed.amount === null) reasons.add('amount_missing')
    if (!parsed.description) reasons.add('description_missing')
  }
  if (policy.requireExplicitAmount && !parsed.explicit.amount) reasons.add('amount_required')
  if (policy.requireExplicitType && !parsed.explicit.type) reasons.add('type_required')
  if (policy.requireExplicitAccount && !hasExplicitRecordAccount(parsed, options)) {
    reasons.add('account_required')
  }
  if ((policy.strict || policy.minConfidenceProvided) && parsed.confidence < policy.minConfidence) {
    reasons.add('confidence_below_minimum')
  }

  return Array.from(reasons)
}

function hasExplicitRecordAccount(
  parsed: ParsedRecordEntry,
  options: Record<string, unknown>
): boolean {
  return (
    (typeof options.account === 'string' && options.account.trim().length > 0) ||
    (typeof options.accountId === 'string' && options.accountId.trim().length > 0) ||
    parsed.explicit.account
  )
}

function recordParseMetadata(parsed: ParsedRecordEntry): Record<string, unknown> {
  return {
    parseConfidence: parsed.confidence,
    parseWarnings: parsed.parseWarnings,
    candidates: parsed.candidates,
    ambiguityReasons: parsed.ambiguityReasons,
  }
}

async function executeRecordCommand(
  parsed: ParsedRecordEntry,
  options: Record<string, unknown>,
  toolDefinitions: ToolDefinition[]
) {
  const apply = Boolean(options.apply)
  const explicitDryRun = Boolean(options.dryRun)
  const allowDuplicate = Boolean(options.allowDuplicate)
  if (apply && explicitDryRun) {
    return errorResult('RECORD_FLAG_CONFLICT', 'Use either --apply or --dry-run, not both.')
  }

  const parsePolicy = getRecordParsePolicy(options)
  if (!parsePolicy.success) return parsePolicy.result

  const strictAmbiguityReasons = getRecordStrictAmbiguityReasons(
    parsed,
    options,
    parsePolicy.policy
  )
  if (strictAmbiguityReasons.length > 0) {
    return errorResult(
      'AMBIGUOUS_RECORD_PARSE',
      'Natural-language record parse is ambiguous. Use explicit flags or relax strict parsing.',
      {
        parsed,
        ...recordParseMetadata(parsed),
        ambiguityReasons: strictAmbiguityReasons,
        strict: parsePolicy.policy.strict,
        minConfidence: parsePolicy.policy.minConfidence,
        requirements: {
          explicitAmount: parsePolicy.policy.requireExplicitAmount,
          explicitType: parsePolicy.policy.requireExplicitType,
          explicitAccount: parsePolicy.policy.requireExplicitAccount,
        },
        hint: 'Try shikin add-transaction with explicit --amount, --type, --description, and --account or --account-id.',
      }
    )
  }

  if (parsed.amount === null || !parsed.description) {
    return errorResult(
      'RECORD_PARSE_FAILED',
      'Could not confidently parse a transaction amount and description.',
      {
        parsed,
        ...recordParseMetadata(parsed),
        hint: 'Try shikin add-transaction with explicit --amount, --type, --description, and --account or --account-id.',
      }
    )
  }

  const status = typeof options.status === 'string' ? options.status.trim() : undefined
  if (status && !RECORD_STATUSES.has(status)) {
    return errorResult('VALIDATION_ERROR', 'Validation error', {
      issues: [
        {
          path: ['status'],
          message: 'Status must be pending, posted, or cleared.',
        },
      ],
    })
  }

  const transactionArgs = compactRecordArgs({
    amount: parsed.amount,
    type: parsed.type,
    description: parsed.description,
    category:
      typeof options.category === 'string' ? options.category : (parsed.category ?? undefined),
    date: parsed.date,
    notes: typeof options.notes === 'string' ? options.notes : undefined,
    source: typeof options.source === 'string' ? options.source : undefined,
    note: typeof options.note === 'string' ? options.note : undefined,
    status,
    allowDuplicate: allowDuplicate ? true : undefined,
    account: typeof options.account === 'string' ? options.account : (parsed.account ?? undefined),
    accountId: typeof options.accountId === 'string' ? options.accountId : undefined,
  })
  const metadata = {
    source: typeof options.source === 'string' ? options.source : null,
    note: typeof options.note === 'string' ? options.note : null,
  }
  const suggestedCommand = {
    command: 'add-transaction',
    args: compactRecordArgs({ ...transactionArgs, dryRun: undefined }),
  }
  const addTransaction = toolDefinitions.find((tool) => tool.name === 'add-transaction')

  if (!addTransaction) {
    return {
      success: true,
      dryRun: true,
      parsed,
      ...recordParseMetadata(parsed),
      metadata,
      requiresConfirmation: true,
      suggestedCommand,
      message:
        'Preview only. Review the parsed fields, then run add-transaction with the suggested args to record it.',
    }
  }

  const previewInput = compactRecordArgs({
    ...addTransaction.schema.parse({ ...transactionArgs, dryRun: true }),
    allowDuplicate: allowDuplicate ? true : undefined,
  })
  const previewResult = await addTransaction.execute(previewInput)
  const normalizedPreview = normalizeResult(previewResult) as Record<string, unknown>
  const previewCurrency = getRecordPreviewCurrency(normalizedPreview)
  if (!isFailureResult(normalizedPreview) && parsed.currency) {
    if (!previewCurrency) {
      return errorResult(
        'RECORD_CURRENCY_UNKNOWN',
        `Record parsed currency ${parsed.currency}, but the resolved account currency is unknown.`,
        {
          parsed,
          ...recordParseMetadata(parsed),
          resolvedCurrency: previewCurrency,
          hint: 'Repair the account currency or run add-transaction explicitly after choosing a valid account.',
        }
      )
    }

    if (parsed.currency !== previewCurrency) {
      return errorResult(
        'RECORD_CURRENCY_MISMATCH',
        `Record parsed currency ${parsed.currency}, but the resolved account uses ${previewCurrency}.`,
        {
          parsed,
          ...recordParseMetadata(parsed),
          resolvedCurrency: previewCurrency,
          hint: 'Use an account with the same currency or run add-transaction explicitly after converting the amount.',
        }
      )
    }
  }

  const duplicateCheck = isFailureResult(normalizedPreview)
    ? null
    : findRecordDuplicateCheck(normalizedPreview, transactionArgs)

  if (!apply) {
    return {
      ...normalizedPreview,
      ...(isFailureResult(normalizedPreview) ? {} : { dryRun: true, requiresConfirmation: true }),
      parsed,
      ...recordParseMetadata(parsed),
      metadata,
      suggestedCommand,
      ...(duplicateCheck?.match ? { duplicateCheck } : {}),
    }
  }

  if (isFailureResult(normalizedPreview)) {
    return {
      ...normalizedPreview,
      parsed,
      ...recordParseMetadata(parsed),
      metadata,
      suggestedCommand,
    }
  }

  if (duplicateCheck?.match && !allowDuplicate) {
    return {
      success: false,
      reason: transactionDuplicateReason(duplicateCheck.match.kind),
      duplicate: duplicateCheck.match,
      duplicateCheck,
      parsed,
      ...recordParseMetadata(parsed),
      metadata,
      suggestedCommand: {
        ...suggestedCommand,
        args: { ...suggestedCommand.args, allowDuplicate: true },
      },
      message:
        duplicateCheck.match.kind === 'exact_duplicate'
          ? `Exact duplicate transaction ${duplicateCheck.match.existingTransactionId} already exists. Re-run with --allow-duplicate to record it anyway.`
          : `Potential duplicate transaction ${duplicateCheck.match.existingTransactionId} is within ${duplicateCheck.match.windowDays} days with similar description. Re-run with --allow-duplicate to record it anyway.`,
    }
  }

  const addInput = compactRecordArgs({
    ...addTransaction.schema.parse({ ...transactionArgs, dryRun: false }),
    allowDuplicate: allowDuplicate ? true : undefined,
  })
  const result = await addTransaction.execute(addInput)
  const normalized = normalizeResult(result) as Record<string, unknown>

  return {
    ...normalized,
    applied: !isFailureResult(normalized),
    parsed,
    ...recordParseMetadata(parsed),
    ...(duplicateCheck?.match && allowDuplicate && !isFailureResult(normalized)
      ? {
          duplicateOverride: {
            allowed: true,
            reason: 'allow_duplicate',
            duplicate: duplicateCheck.match,
            duplicateCheck,
          },
        }
      : {}),
  }
}

function compactRecordArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
}

function findRecordDuplicateCheck(
  previewResult: Record<string, unknown>,
  transactionArgs: Record<string, unknown>
): TransactionDuplicateCheck | null {
  const transactionPreview = getRecordPreviewTransaction(previewResult)
  const accountId =
    stringField(transactionPreview, 'accountId') ?? stringField(transactionArgs, 'accountId')
  const date = stringField(transactionPreview, 'date') ?? stringField(transactionArgs, 'date')
  const description =
    stringField(transactionPreview, 'description') ?? stringField(transactionArgs, 'description')
  const type = stringField(transactionPreview, 'type') ?? stringField(transactionArgs, 'type')
  const amount = numberField(transactionPreview, 'amount') ?? numberField(transactionArgs, 'amount')
  const status = stringField(transactionPreview, 'status') ?? stringField(transactionArgs, 'status')
  const transferToAccountId =
    stringField(transactionPreview, 'transferToAccountId') ??
    stringField(transactionArgs, 'transferToAccountId')

  if (!accountId || !date || !description || amount === null) return null
  if (type !== 'expense' && type !== 'income' && type !== 'transfer') return null

  return findTransactionDuplicate({
    accountId,
    date,
    amountCentavos: toCentavos(amount),
    type,
    status: status === 'pending' || status === 'cleared' ? status : 'posted',
    transferToAccountId,
    description,
  })
}

function getRecordPreviewTransaction(result: Record<string, unknown>): Record<string, unknown> {
  if (result.wouldCreate && typeof result.wouldCreate === 'object') {
    return result.wouldCreate as Record<string, unknown>
  }
  if (result.transaction && typeof result.transaction === 'object') {
    return result.transaction as Record<string, unknown>
  }
  return {}
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getRecordPreviewCurrency(result: Record<string, unknown>): string | null {
  const candidate =
    result.wouldCreate && typeof result.wouldCreate === 'object'
      ? (result.wouldCreate as Record<string, unknown>).currency
      : result.transaction && typeof result.transaction === 'object'
        ? (result.transaction as Record<string, unknown>).currency
        : null

  if (typeof candidate !== 'string') return null
  const currency = candidate.trim().toUpperCase()
  return currency === '' ? null : currency
}

// Convert a Zod schema to commander options
export function zodToOptions(schema: z.ZodObject<any>): Array<{
  flag: string
  description: string
  required: boolean
  isArray: boolean
  isBoolean: boolean
  isStructured: boolean
  defaultValue?: unknown
}> {
  const shape = schema.shape
  const options: Array<{
    flag: string
    description: string
    required: boolean
    isArray: boolean
    isBoolean: boolean
    isStructured: boolean
    defaultValue?: unknown
  }> = []

  for (const [key, zodType] of Object.entries(shape)) {
    const { required, defaultValue } = getOptionWrapperMetadata(zodType as z.ZodTypeAny)
    const inner = unwrapSchema(zodType as z.ZodTypeAny)
    let isArray = false
    let isBoolean = false
    let isStructured = false

    // Check type
    if (inner instanceof z.ZodBoolean) {
      isBoolean = true
    } else if (inner instanceof z.ZodArray) {
      isArray = true
      isStructured = true
    } else if (inner instanceof z.ZodObject) {
      isStructured = true
    }

    const flag = camelToKebab(key)
    const rawDesc = (inner as any)?.description || (zodType as any)?.description || ''
    const desc = isStructured
      ? `${rawDesc}${rawDesc ? ' ' : ''}Pass as JSON (example: '[{"key":"value"}]').`
      : rawDesc

    options.push({
      flag,
      description: desc,
      required,
      isArray,
      isBoolean,
      isStructured,
      defaultValue,
    })
  }

  return options
}

function getOptionWrapperMetadata(schema: z.ZodTypeAny): {
  required: boolean
  defaultValue?: unknown
} {
  let current = schema
  let required = true
  let defaultValue: unknown = undefined

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    if (current instanceof z.ZodDefault) {
      defaultValue = current._def.defaultValue()
      required = false
      current = current._def.innerType
      continue
    }

    if (current instanceof z.ZodOptional) {
      required = false
    }

    current = current.unwrap()
  }

  return { required, defaultValue }
}

type DiagnoseSummary = {
  success: boolean
  toolCount: number
  toolAvailability: {
    cliAvailable: number
    cliUnavailable: number
    cliUnavailableTools: string[]
    mcpAvailable: number
    mcpUnavailable: number
    mcpUnavailableTools: string[]
  }
  database: {
    ready: boolean
    migrationCount: number
    latestMigration: string | null
    accountCount: number
    categoryCount: number
    transactionCount: number
    integrity?: {
      integrityCheck: { ok: boolean; result: string }
      foreignKeyCheck: { ok: boolean; violations: Array<Record<string, unknown>> }
      migrations: {
        expected: number
        applied: number
        missing: string[]
        unexpected: string[]
      }
      balances: {
        ok: boolean
        mismatches: Array<{
          accountId: string
          accountName: string
          storedBalance: number
          computedBalance: number
          difference: number
        }>
      }
      recurringRuleCurrency: {
        checked: boolean
        ok: boolean
        missingCurrency: Array<{
          ruleId: string
          description: string
          accountId: string | null
          accountName: string | null
        }>
        accountCurrencyMismatch: Array<{
          ruleId: string
          description: string
          accountId: string | null
          accountName: string | null
          ruleCurrency: string
          accountCurrency: string | null
        }>
      }
    }
  }
}

function normalizeCurrency(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function getDiagnoseSummary(toolDefinitions: ToolDefinition[], deep: boolean): DiagnoseSummary {
  const toolCount = toolDefinitions.length
  const migrations = query<{ name: string }>('SELECT name FROM _migrations ORDER BY id ASC')
  const accountCount =
    query<{ count: number }>('SELECT COUNT(*) as count FROM accounts')[0]?.count ?? 0
  const categoryCount =
    query<{ count: number }>('SELECT COUNT(*) as count FROM categories')[0]?.count ?? 0
  const transactionCount =
    query<{ count: number }>('SELECT COUNT(*) as count FROM transactions')[0]?.count ?? 0

  const cliUnavailableTools = toolDefinitions
    .filter((tool) => tool.cliUnavailableMessage)
    .map((tool) => tool.name)
    .sort()
  const mcpUnavailableTools = toolDefinitions
    .filter((tool) => tool.mcpUnavailableMessage)
    .map((tool) => tool.name)
    .sort()

  const summary: DiagnoseSummary = {
    success: true,
    toolCount,
    toolAvailability: {
      cliAvailable: toolCount - cliUnavailableTools.length,
      cliUnavailable: cliUnavailableTools.length,
      cliUnavailableTools,
      mcpAvailable: toolCount - mcpUnavailableTools.length,
      mcpUnavailable: mcpUnavailableTools.length,
      mcpUnavailableTools,
    },
    database: {
      ready: true,
      migrationCount: migrations.length,
      latestMigration: migrations.at(-1)?.name ?? null,
      accountCount,
      categoryCount,
      transactionCount,
    },
  }

  if (!deep) {
    return summary
  }

  const integrityCheckResult =
    query<{ integrity_check?: string }>('PRAGMA integrity_check')[0]?.integrity_check ?? 'unknown'
  const foreignKeyViolations = query<Record<string, unknown>>('PRAGMA foreign_key_check')
  const appliedMigrationNames = migrations.map((migration) => migration.name)
  const appliedMigrationSet = new Set(appliedMigrationNames)
  const expectedMigrationSet = new Set(EXPECTED_MIGRATIONS)
  const missingMigrations = EXPECTED_MIGRATIONS.filter(
    (migration) => !appliedMigrationSet.has(migration)
  )
  const unexpectedMigrations = appliedMigrationNames.filter(
    (migration) => !expectedMigrationSet.has(migration as (typeof EXPECTED_MIGRATIONS)[number])
  )
  const balanceRows = query<{
    accountId: string
    accountName: string
    storedBalance: number
    computedBalance: number
  }>(
    `SELECT
       a.id AS accountId,
       a.name AS accountName,
       a.balance AS storedBalance,
       COALESCE(
         SUM(
           CASE
             WHEN t.type = 'income' AND t.account_id = a.id THEN t.amount
             WHEN t.type = 'expense' AND t.account_id = a.id THEN -t.amount
             WHEN t.type = 'transfer' AND t.account_id = a.id THEN -t.amount
             WHEN t.type = 'transfer' AND t.transfer_to_account_id = a.id THEN t.amount
             ELSE 0
           END
         ),
         0
       ) AS computedBalance
     FROM accounts a
     LEFT JOIN transactions t ON (t.account_id = a.id OR t.transfer_to_account_id = a.id)
       AND COALESCE(NULLIF(TRIM(t.status), ''), 'posted') IN ('posted', 'cleared')
     GROUP BY a.id, a.name, a.balance
     ORDER BY a.name ASC, a.id ASC`
  )
  const balanceMismatches = balanceRows
    .filter((row) => row.storedBalance !== row.computedBalance)
    .map((row) => ({
      ...row,
      difference: row.storedBalance - row.computedBalance,
    }))

  const recurringRuleColumns = query<{ name: string }>('PRAGMA table_info(recurring_rules)')
  const hasRecurringRuleCurrency = recurringRuleColumns.some((column) => column.name === 'currency')
  const recurringRuleCurrencyRows = hasRecurringRuleCurrency
    ? query<{
        ruleId: string
        description: string
        accountId: string | null
        accountName: string | null
        ruleCurrency: string | null
        accountCurrency: string | null
      }>(
        `SELECT
           r.id AS ruleId,
           r.description AS description,
           r.account_id AS accountId,
           a.name AS accountName,
           r.currency AS ruleCurrency,
           a.currency AS accountCurrency
         FROM recurring_rules r
         LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.currency IS NULL
            OR TRIM(r.currency) = ''
            OR a.currency IS NULL
            OR TRIM(a.currency) = ''
            OR UPPER(TRIM(r.currency)) <> UPPER(TRIM(a.currency))
         ORDER BY r.id ASC`
      )
    : []

  const recurringMissingCurrency = recurringRuleCurrencyRows
    .filter((row) => normalizeCurrency(row.ruleCurrency) === '')
    .map((row) => ({
      ruleId: row.ruleId,
      description: row.description,
      accountId: row.accountId,
      accountName: row.accountName,
    }))

  const recurringAccountCurrencyMismatch = recurringRuleCurrencyRows
    .filter((row) => normalizeCurrency(row.ruleCurrency) !== '')
    .filter(
      (row) =>
        normalizeCurrency(row.accountCurrency) === '' ||
        normalizeCurrency(row.ruleCurrency) !== normalizeCurrency(row.accountCurrency)
    )
    .map((row) => ({
      ruleId: row.ruleId,
      description: row.description,
      accountId: row.accountId,
      accountName: row.accountName,
      ruleCurrency: normalizeCurrency(row.ruleCurrency),
      accountCurrency:
        normalizeCurrency(row.accountCurrency) === ''
          ? null
          : normalizeCurrency(row.accountCurrency),
    }))

  summary.database.integrity = {
    integrityCheck: {
      ok: integrityCheckResult === 'ok',
      result: integrityCheckResult,
    },
    foreignKeyCheck: {
      ok: foreignKeyViolations.length === 0,
      violations: foreignKeyViolations,
    },
    migrations: {
      expected: EXPECTED_MIGRATIONS.length,
      applied: migrations.length,
      missing: [...missingMigrations],
      unexpected: unexpectedMigrations,
    },
    balances: {
      ok: balanceMismatches.length === 0,
      mismatches: balanceMismatches,
    },
    recurringRuleCurrency: {
      checked: hasRecurringRuleCurrency,
      ok:
        hasRecurringRuleCurrency &&
        recurringMissingCurrency.length === 0 &&
        recurringAccountCurrencyMismatch.length === 0,
      missingCurrency: recurringMissingCurrency,
      accountCurrencyMismatch: recurringAccountCurrencyMismatch,
    },
  }

  return summary
}

export function createProgram(toolDefinitions: ToolDefinition[] = tools): Command {
  const program = new Command()
    .name('shikin')
    .description('Shikin — control your finances from the command line')
    .version('1.0.8')

  addOutputOptions(
    program
      .command('diagnose')
      .description('Validate shared database connectivity and print CLI/MCP health details')
      .option('--deep', 'Run read-only integrity, foreign-key, migration, and balance checks')
  ).action((options: Record<string, unknown>) => {
    const outputOptions = getOutputOptions(options)
    try {
      writeOutput(getDiagnoseSummary(toolDefinitions, Boolean(options.deep)), outputOptions)
    } catch (err) {
      writeOutput(
        errorResult('DIAGNOSE_FAILED', err instanceof Error ? err.message : String(err)),
        outputOptions
      )
      process.exitCode = 1
    } finally {
      close()
    }
  })

  addOutputOptions(
    program.command('tools').description('Return machine-readable command discovery metadata')
  ).action((options: Record<string, unknown>) => {
    writeOutput(getCommandCatalog(toolDefinitions), getOutputOptions(options))
    close()
  })

  addOutputOptions(
    program
      .command('validate')
      .description('Validate another command without executing it')
      .argument('<commandName>', 'Command to validate')
      .argument('[args...]', 'Command options to validate')
      .allowUnknownOption(true)
      .allowExcessArguments(true),
    { includeRedacted: false }
  ).action((commandName: string, args: string[] = [], options: Record<string, unknown>) => {
    const outputOptions = getOutputOptions(options)
    const result = validateToolInput(commandName, args, toolDefinitions)
    writeOutput(result, outputOptions)
    if (isFailureResult(normalizeResult(result))) process.exitCode = 1
    close()
  })

  addOutputOptions(
    program
      .command('record')
      .description('Parse a natural-language transaction entry and return a confirmation preview')
      .argument('<entry...>', 'Natural-language transaction entry')
      .option('--apply', 'Apply the parsed transaction noninteractively')
      .option('--dry-run', 'Validate and preview the parsed transaction without writing it')
      .option('--strict', 'Fail when natural-language parsing is ambiguous or low-confidence')
      .option('--min-confidence <value>', 'Minimum parse confidence from 0 to 1 before recording')
      .option('--require-explicit-type', 'Require income or expense intent to be explicit')
      .option('--require-explicit-account', 'Require account via flag or account phrase')
      .option('--require-explicit-amount', 'Require an explicit amount in the entry')
      .option('--allow-duplicate', 'Apply even when an exact or likely duplicate is detected')
      .option('--account <value>', 'Account alias, exact account ID, or exact account name')
      .option('--account-id <value>', 'Canonical account ID')
      .option('--category <value>', 'Category name override')
      .option('--status <status>', 'Transaction status: pending, posted, or cleared')
      .option('--notes <value>', 'User transaction notes')
      .option('--source <value>', 'Automation source or origin label for transaction provenance')
      .option('--note <value>', 'Workflow changelog note for transaction provenance')
  ).action(async (entryParts: string[], options: Record<string, unknown>) => {
    const outputOptions = getOutputOptions(options)
    const entry = entryParts.join(' ')
    const parsed = parseRecordEntry(entry)

    try {
      const result = await executeRecordCommand(parsed, options, toolDefinitions)
      writeOutput(result, outputOptions)
      if (isFailureResult(normalizeResult(result))) process.exitCode = 1
    } catch (err) {
      writeOutput(errorFromUnknown(err), outputOptions)
      process.exitCode = 1
    } finally {
      close()
    }
  })

  // Register each tool as a CLI command
  for (const tool of toolDefinitions) {
    const cmd = program.command(tool.name).description(tool.description)
    addOutputOptions(cmd)

    if (tool.name === 'query-transactions') {
      cmd.alias('list-transactions')
    }
    if (tool.name === 'backup-database') {
      cmd.alias('backup')
    }
    if (tool.name === 'restore-database') {
      cmd.alias('restore')
    }

    const schemaShape = tool.schema.shape
    if (schemaShape && Object.keys(schemaShape).length > 0) {
      const options = zodToOptions(tool.schema)

      for (const opt of options) {
        if (OUTPUT_OPTION_KEYS.has(kebabToCamel(opt.flag))) {
          continue
        }

        const placeholder = opt.isStructured ? '<json>' : '<value>'
        const flagStr = opt.isBoolean
          ? opt.defaultValue === true
            ? `--no-${opt.flag}`
            : opt.defaultValue === undefined
              ? `--${opt.flag} [value]`
              : `--${opt.flag}`
          : `--${opt.flag} ${placeholder}`

        cmd.option(flagStr, opt.description, opt.defaultValue as string)
      }
    }

    cmd.action(async (opts: Record<string, unknown>) => {
      const outputOptions = getOutputOptions(opts)
      try {
        if (tool.cliUnavailableMessage) {
          writeOutput(
            errorResult('UNAVAILABLE_ERROR', tool.cliUnavailableMessage, {
              error: tool.cliUnavailableMessage,
              errorType: 'unavailable_error',
            }),
            outputOptions
          )
          process.exitCode = 1
          return
        }

        // Convert CLI string values to proper types based on schema
        const input = coerceInput(opts, tool.schema)
        const parsed = tool.schema.parse(input)
        const result = await tool.execute(parsed)

        writeOutput(result, outputOptions)

        if (isFailureResult(normalizeResult(result))) {
          process.exitCode = 1
        }
      } catch (err) {
        writeOutput(errorFromUnknown(err), outputOptions)
        process.exitCode = 1
      } finally {
        close()
      }
    })
  }

  return program
}

const program = createProgram()

// Coerce string CLI inputs to proper types based on Zod schema
export function coerceInput(
  opts: Record<string, unknown>,
  schema: z.ZodObject<any>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const shape = schema.shape

  for (const [key, value] of Object.entries(opts)) {
    // Commander uses camelCase for options
    if (value === undefined) continue

    const zodType = shape[key] as z.ZodTypeAny | undefined
    if (OUTPUT_OPTION_KEYS.has(key) && !zodType) continue
    if (!zodType) continue

    result[key] = coerceValue(value, zodType, key)
  }

  return result
}

function coerceValue(value: unknown, schema: z.ZodTypeAny, optionName = 'value'): unknown {
  const zodType = unwrapSchema(schema)

  if (zodType instanceof z.ZodNumber) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed === '' ? trimmed : Number(trimmed)
    }
    return value
  }

  if (zodType instanceof z.ZodBoolean) {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
    return value === true || value === 'true'
  }

  if (zodType instanceof z.ZodString) {
    return value
  }

  if (zodType instanceof z.ZodArray) {
    const structuredValue = parseStructuredValue(value, optionName)
    if (!Array.isArray(structuredValue)) return structuredValue
    return structuredValue.map((item) => coerceValue(item, zodType.element, optionName))
  }

  if (zodType instanceof z.ZodObject) {
    const structuredValue = parseStructuredValue(value, optionName)
    if (!structuredValue || typeof structuredValue !== 'object' || Array.isArray(structuredValue)) {
      return structuredValue
    }

    const objectShape = zodType.shape
    return Object.fromEntries(
      Object.entries(structuredValue).map(([key, nestedValue]) => [
        key,
        objectShape[key]
          ? coerceValue(nestedValue, objectShape[key] as z.ZodTypeAny, `${optionName}.${key}`)
          : nestedValue,
      ])
    )
  }

  return value
}

function parseStructuredValue(value: unknown, optionName: string): unknown {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  const looksLikeJson =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))

  if (!looksLikeJson) return value

  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(
      `Invalid JSON for --${camelToKebab(optionName)}. Provide valid JSON for structured options.`
    )
  }
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodEffects
  ) {
    if (current instanceof z.ZodDefault) {
      current = current._def.innerType
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema
    } else {
      current = current.unwrap()
    }
  }

  return current
}

if (isDirectExecution()) {
  program.parse()
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry ? import.meta.url === pathToFileURL(entry).href : false
}
