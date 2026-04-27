#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { tools, type ToolDefinition } from './tools.js'
import { close, query } from './database.js'
import { z } from 'zod'

const EXPECTED_MIGRATIONS = [
  '001_core_tables',
  '003_credit_cards',
  '004_category_rules',
  '005_recurring_rules',
  '006_goals',
  '007_recaps',
  '010_transaction_splits',
  '011_net_worth_snapshots',
  '012_account_balance_history',
  '013_recurring_rules_currency',
  '014_recurring_rules_currency_backfill',
] as const

function isFailureResult(value: unknown): value is Record<string, unknown> & { success: false } {
  return (
    typeof value === 'object' && value !== null && 'success' in value && value.success === false
  )
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

    const flag = key.replace(/([A-Z])/g, '-$1').toLowerCase() // camelCase → kebab-case
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
     LEFT JOIN transactions t ON t.account_id = a.id OR t.transfer_to_account_id = a.id
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
    .version('0.2.5')

  program
    .command('diagnose')
    .description('Validate shared database connectivity and print CLI/MCP health details')
    .option('--deep', 'Run read-only integrity, foreign-key, migration, and balance checks')
    .action((options: { deep?: boolean }) => {
      try {
        console.log(
          JSON.stringify(getDiagnoseSummary(toolDefinitions, Boolean(options.deep)), null, 2)
        )
      } catch (err) {
        console.log(
          JSON.stringify(
            {
              success: false,
              message: err instanceof Error ? err.message : String(err),
            },
            null,
            2
          )
        )
        process.exitCode = 1
      } finally {
        close()
      }
    })

  // Register each tool as a CLI command
  for (const tool of toolDefinitions) {
    const cmd = program.command(tool.name).description(tool.description)

    const schemaShape = tool.schema.shape
    if (schemaShape && Object.keys(schemaShape).length > 0) {
      const options = zodToOptions(tool.schema)

      for (const opt of options) {
        const placeholder = opt.isStructured ? '<json>' : '<value>'
        const flagStr = opt.isBoolean
          ? opt.defaultValue === true
            ? `--no-${opt.flag}`
            : `--${opt.flag}`
          : `--${opt.flag} ${placeholder}`

        if (opt.required) {
          cmd.requiredOption(flagStr, opt.description)
        } else {
          cmd.option(flagStr, opt.description, opt.defaultValue as string)
        }
      }
    }

    cmd.action(async (opts) => {
      try {
        // Convert CLI string values to proper types based on schema
        const input = coerceInput(opts, tool.schema)
        const parsed = tool.schema.parse(input)
        const result = await tool.execute(parsed)

        console.log(JSON.stringify(result, null, 2))

        if (isFailureResult(result)) {
          process.exitCode = 1
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.error(JSON.stringify({ error: 'Validation error', issues: err.issues }, null, 2))
        } else {
          console.error(
            JSON.stringify(
              {
                error: err instanceof Error ? err.message : String(err),
              },
              null,
              2
            )
          )
        }
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
      `Invalid JSON for --${optionName.replace(/([A-Z])/g, '-$1').toLowerCase()}. Provide valid JSON for structured options.`
    )
  }
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current instanceof z.ZodDefault ? current._def.innerType : current.unwrap()
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
