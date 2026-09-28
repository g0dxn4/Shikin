// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertAutomationCatalog } from './assert-automation-catalog.mjs'

const inventory = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../cli/src/fixtures/public-automation-inventory.json'
    ),
    'utf8'
  )
)

const REQUIRED_SCHEMAS = {
  'correct-transaction-metadata': ['transactionId', 'dryRun'],
  'set-transaction-consumption': ['transactionId', 'role'],
  'clear-transaction-consumption': ['classificationId'],
  'update-bucket': ['bucketId', 'bucketName', 'dryRun'],
  'delete-bucket': ['bucketId', 'bucketName', 'dryRun'],
  'reverse-bucket-allocation': ['allocationId', 'dryRun'],
  'correct-bucket-allocation': ['allocationId', 'amount', 'dryRun'],
  'set-source-coverage': ['sourceNamespace', 'periodStart', 'periodEnd', 'status'],
  'list-source-coverage': ['sourceNamespace'],
  'settle-staged-transactions': ['transactionIds', 'status', 'apply'],
  'supersede-reconciliation-bridge': ['transactionIds', 'coverageIds', 'previewToken'],
  'bind-transaction-import-identity': ['transactionId', 'sourceNamespace', 'externalId'],
  'link-card-statement-payment': ['statementId', 'transactionId', 'amount', 'mode'],
  'unlink-card-statement-payment': ['linkId', 'dryRun'],
  'list-card-statement-payment-links': ['statementId', 'transactionId', 'status'],
  'get-runtime-diagnostics': [],
}

const EXPECTED_EFFECTS = {
  'get-spending-recap': { readOnly: true, writesTo: [] },
  'save-spending-recap': { readOnly: false, idempotent: true, writesTo: ['recaps', 'audit_log'] },
  'query-transactions': { readOnly: true, writesTo: [] },
  'get-runtime-diagnostics': { readOnly: true, idempotent: true },
  'bind-transaction-import-identity': {
    writesTo: ['transactions', 'audit_log', 'app_data_state'],
  },
  'import-transactions': {
    writesTo: [
      'accounts',
      'transactions',
      'duplicate_review_decisions',
      'audit_log',
      'app_data_state',
    ],
  },
  'link-card-statement-payment': {
    writesTo: [
      'card_statement_payment_links',
      'credit_card_statements',
      'audit_log',
      'app_data_state',
    ],
  },
  'list-card-statement-payment-links': { readOnly: true, writesTo: [] },
  'add-transaction': {
    writesTo: [
      'transactions',
      'accounts',
      'transaction_fx_evidence',
      'audit_log',
      'app_data_state',
    ],
  },
}

function annotationsFromEffects(effects) {
  const annotations = {}
  if (typeof effects?.readOnly === 'boolean') annotations.readOnlyHint = effects.readOnly
  if (typeof effects?.idempotent === 'boolean') annotations.idempotentHint = effects.idempotent
  return annotations
}

function createMatchingSurfaces() {
  const commands = inventory.commands.map((name) => {
    const effects = EXPECTED_EFFECTS[name]
    return {
      name,
      kind: inventory.tools.includes(name) ? 'tool' : 'command',
      options: (REQUIRED_SCHEMAS[name] ?? []).map((option) => ({ name: option })),
      ...(effects === undefined ? {} : { effects }),
    }
  })
  const mcpTools = inventory.tools.map((name) => {
    const effects = EXPECTED_EFFECTS[name]
    return {
      name,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          (REQUIRED_SCHEMAS[name] ?? []).map((option) => [option, { type: 'string' }])
        ),
      },
      annotations: annotationsFromEffects(effects),
    }
  })

  return {
    cliCatalog: {
      toolCount: inventory.tools.length,
      commandCount: inventory.commands.length,
      compatibility: { effects: { declaredOnly: true } },
      commands,
    },
    mcpTools,
  }
}

function commandIndex(cliCatalog, name) {
  return cliCatalog.commands.findIndex((command) => command.name === name)
}

function toolIndex(mcpTools, name) {
  return mcpTools.findIndex((tool) => tool.name === name)
}

describe('assertAutomationCatalog', () => {
  it('accepts a catalog that matches the versioned inventory names, counts, schemas, and effects', () => {
    const { cliCatalog, mcpTools } = createMatchingSurfaces()
    expect(() => assertAutomationCatalog(cliCatalog, mcpTools, inventory)).not.toThrow()
  })

  it('rejects a missing CLI command or MCP tool name', () => {
    const missingCommand = createMatchingSurfaces()
    missingCommand.cliCatalog.commands = missingCommand.cliCatalog.commands.filter(
      (command) => command.name !== 'allocate-income'
    )
    missingCommand.cliCatalog.commandCount = missingCommand.cliCatalog.commands.length
    missingCommand.cliCatalog.toolCount = missingCommand.cliCatalog.commands.filter(
      (command) => command.kind === 'tool'
    ).length
    missingCommand.mcpTools = missingCommand.mcpTools.filter(
      (tool) => tool.name !== 'allocate-income'
    )

    const missingMcp = createMatchingSurfaces()
    missingMcp.mcpTools = missingMcp.mcpTools.filter((tool) => tool.name !== 'allocate-income')

    expect(() =>
      assertAutomationCatalog(missingCommand.cliCatalog, missingCommand.mcpTools, inventory)
    ).toThrow(
      `CLI command count was ${inventory.commands.length - 1}; expected ${inventory.commands.length} from versioned inventory`
    )
    expect(() =>
      assertAutomationCatalog(missingMcp.cliCatalog, missingMcp.mcpTools, inventory)
    ).toThrow(
      `MCP tool count was ${inventory.tools.length - 1}; expected ${inventory.tools.length} from versioned inventory`
    )
  })

  it('rejects an extra CLI command or MCP tool name', () => {
    const extraCommand = createMatchingSurfaces()
    extraCommand.cliCatalog.commands.push({
      name: 'fixture-extra-command',
      kind: 'command',
      options: [],
    })
    extraCommand.cliCatalog.commandCount += 1

    const extraTool = createMatchingSurfaces()
    extraTool.mcpTools.push({
      name: 'fixture-extra-tool',
      inputSchema: { type: 'object', properties: {} },
      annotations: {},
    })

    expect(() =>
      assertAutomationCatalog(extraCommand.cliCatalog, extraCommand.mcpTools, inventory)
    ).toThrow(
      `CLI command count was ${inventory.commands.length + 1}; expected ${inventory.commands.length} from versioned inventory`
    )
    expect(() =>
      assertAutomationCatalog(extraTool.cliCatalog, extraTool.mcpTools, inventory)
    ).toThrow(
      `MCP tool count was ${inventory.tools.length + 1}; expected ${inventory.tools.length} from versioned inventory`
    )
  })

  it('rejects duplicate CLI command and MCP tool names', () => {
    const duplicateCommand = createMatchingSurfaces()
    const command =
      duplicateCommand.cliCatalog.commands[commandIndex(duplicateCommand.cliCatalog, 'web')]
    duplicateCommand.cliCatalog.commands.push({ ...command })
    duplicateCommand.cliCatalog.commandCount += 1

    const duplicateTool = createMatchingSurfaces()
    const tool = duplicateTool.mcpTools[toolIndex(duplicateTool.mcpTools, 'allocate-income')]
    duplicateTool.mcpTools.push({ ...tool })

    expect(() =>
      assertAutomationCatalog(duplicateCommand.cliCatalog, duplicateCommand.mcpTools, inventory)
    ).toThrow(/CLI command names were not unique/)
    expect(() =>
      assertAutomationCatalog(duplicateTool.cliCatalog, duplicateTool.mcpTools, inventory)
    ).toThrow(/MCP tool names were not unique/)
  })

  it('rejects catalog counts that do not match the versioned inventory', () => {
    const wrongToolCount = createMatchingSurfaces()
    wrongToolCount.cliCatalog.toolCount = inventory.tools.length - 1
    const wrongCommandCount = createMatchingSurfaces()
    wrongCommandCount.cliCatalog.commandCount = inventory.commands.length - 1

    expect(() =>
      assertAutomationCatalog(wrongToolCount.cliCatalog, wrongToolCount.mcpTools, inventory)
    ).toThrow(
      `Deployed catalog toolCount was ${inventory.tools.length - 1}; expected ${inventory.tools.length} from versioned inventory`
    )
    expect(() =>
      assertAutomationCatalog(wrongCommandCount.cliCatalog, wrongCommandCount.mcpTools, inventory)
    ).toThrow(
      `Deployed catalog commandCount was ${inventory.commands.length - 1}; expected ${inventory.commands.length} from versioned inventory`
    )
  })

  it('rejects a same-count catalog that swaps a real name', () => {
    const swappedCommand = createMatchingSurfaces()
    swappedCommand.cliCatalog.commands[commandIndex(swappedCommand.cliCatalog, 'diagnose')].name =
      'diagnoses'

    const swappedTool = createMatchingSurfaces()
    swappedTool.mcpTools[toolIndex(swappedTool.mcpTools, 'allocate-income')].name =
      'allocate-incomes'

    expect(() =>
      assertAutomationCatalog(swappedCommand.cliCatalog, swappedCommand.mcpTools, inventory)
    ).toThrow(/CLI command names did not match the versioned inventory/)
    expect(() =>
      assertAutomationCatalog(swappedTool.cliCatalog, swappedTool.mcpTools, inventory)
    ).toThrow(/MCP tool names did not match the versioned inventory/)
  })

  it('rejects add-transaction effect regressions', () => {
    const missingEffects = createMatchingSurfaces()
    delete missingEffects.cliCatalog.commands[
      commandIndex(missingEffects.cliCatalog, 'add-transaction')
    ].effects

    const wrongEffects = createMatchingSurfaces()
    wrongEffects.cliCatalog.commands[
      commandIndex(wrongEffects.cliCatalog, 'add-transaction')
    ].effects = {
      writesTo: ['transactions'],
    }

    expect(() =>
      assertAutomationCatalog(missingEffects.cliCatalog, missingEffects.mcpTools, inventory)
    ).toThrow(/CLI add-transaction effects were invalid/)
    expect(() =>
      assertAutomationCatalog(wrongEffects.cliCatalog, wrongEffects.mcpTools, inventory)
    ).toThrow(/CLI add-transaction effects were invalid/)
  })
})
