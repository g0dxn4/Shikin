function sortedCopy(names) {
  return [...names].sort()
}

function duplicateNames(names) {
  const seen = new Set()
  const duplicates = []
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name)
    else seen.add(name)
  }
  return duplicates
}

function assertExactUniqueNames(actualNames, expectedNames, label) {
  if (!Array.isArray(actualNames)) {
    throw new Error(`${label} names were missing.`)
  }
  if (!Array.isArray(expectedNames) || expectedNames.length === 0) {
    throw new Error(`Versioned ${label} inventory names were missing.`)
  }

  const expectedDuplicates = duplicateNames(expectedNames)
  if (expectedDuplicates.length > 0) {
    throw new Error(
      `Versioned ${label} inventory contains duplicate names: ${JSON.stringify(expectedDuplicates)}`
    )
  }

  const actualDuplicates = duplicateNames(actualNames)
  if (actualDuplicates.length > 0) {
    throw new Error(`${label} names were not unique: ${JSON.stringify(actualDuplicates)}`)
  }

  const actualSorted = sortedCopy(actualNames)
  const expectedSorted = sortedCopy(expectedNames)
  if (actualSorted.length !== expectedSorted.length) {
    throw new Error(
      `${label} count was ${actualSorted.length}; expected ${expectedSorted.length} from versioned inventory.`
    )
  }
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} names did not match the versioned inventory. actual=${JSON.stringify(actualSorted)} expected=${JSON.stringify(expectedSorted)}`
    )
  }
}

export function assertAutomationCatalog(cliCatalog, mcpTools, inventory) {
  if (!inventory || typeof inventory !== 'object') {
    throw new Error('Versioned public automation inventory is required.')
  }

  const commands = cliCatalog?.commands ?? []
  const cliTools = commands.filter((command) => command.kind === 'tool')
  assertExactUniqueNames(
    commands.map((command) => command.name),
    inventory.commands,
    'CLI command'
  )
  assertExactUniqueNames(
    cliTools.map((tool) => tool.name),
    inventory.tools,
    'CLI tool'
  )
  assertExactUniqueNames(
    (mcpTools ?? []).map((tool) => tool.name),
    inventory.tools,
    'MCP tool'
  )

  if (cliCatalog.toolCount !== inventory.tools.length) {
    throw new Error(
      `Deployed catalog toolCount was ${cliCatalog.toolCount}; expected ${inventory.tools.length} from versioned inventory.`
    )
  }
  if (cliCatalog.commandCount !== inventory.commands.length) {
    throw new Error(
      `Deployed catalog commandCount was ${cliCatalog.commandCount}; expected ${inventory.commands.length} from versioned inventory.`
    )
  }
  if (cliCatalog.compatibility?.effects?.declaredOnly !== true) {
    throw new Error(
      `CLI catalog did not mark effects as declared-only: ${JSON.stringify(cliCatalog.compatibility)}`
    )
  }

  const cliByName = new Map(commands.map((command) => [command.name, command]))
  const mcpByName = new Map((mcpTools ?? []).map((tool) => [tool.name, tool]))
  const cliGet = cliByName.get('get-spending-recap')
  const cliSave = cliByName.get('save-spending-recap')
  const mcpGet = mcpByName.get('get-spending-recap')
  const mcpSave = mcpByName.get('save-spending-recap')
  const requiredSchemas = {
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

  for (const [name, requiredOptions] of Object.entries(requiredSchemas)) {
    const cliTool = cliByName.get(name)
    const mcpTool = mcpByName.get(name)
    if (!cliTool || cliTool.kind !== 'tool' || !mcpTool) {
      throw new Error(`Deployed discovery omitted ${name}.`)
    }
    const cliOptions = new Set((cliTool.options ?? []).map((option) => option.name))
    const mcpProperties = new Set(Object.keys(mcpTool.inputSchema?.properties ?? {}))
    for (const option of requiredOptions) {
      if (!cliOptions.has(option) || !mcpProperties.has(option)) {
        throw new Error(`${name} discovery omitted schema option ${option}.`)
      }
    }
  }

  if (JSON.stringify(cliGet?.effects) !== JSON.stringify({ readOnly: true, writesTo: [] })) {
    throw new Error(`CLI get-spending-recap effects were invalid: ${JSON.stringify(cliGet)}`)
  }
  if (
    JSON.stringify(cliSave?.effects) !==
    JSON.stringify({ readOnly: false, idempotent: true, writesTo: ['recaps', 'audit_log'] })
  ) {
    throw new Error(`CLI save-spending-recap effects were invalid: ${JSON.stringify(cliSave)}`)
  }
  const expectedEffects = {
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
  for (const [name, effects] of Object.entries(expectedEffects)) {
    if (JSON.stringify(cliByName.get(name)?.effects) !== JSON.stringify(effects)) {
      throw new Error(`CLI ${name} effects were invalid: ${JSON.stringify(cliByName.get(name))}`)
    }
  }
  if (cliByName.get('list-accounts')?.effects !== undefined) {
    throw new Error('CLI catalog claimed effects for unaudited list-accounts.')
  }

  if (JSON.stringify(mcpGet?.annotations) !== JSON.stringify({ readOnlyHint: true })) {
    throw new Error(
      `MCP get-spending-recap annotations were invalid: ${JSON.stringify(mcpGet?.annotations)}`
    )
  }
  if (
    JSON.stringify(mcpSave?.annotations) !==
    JSON.stringify({ readOnlyHint: false, idempotentHint: true })
  ) {
    throw new Error(
      `MCP save-spending-recap annotations were invalid: ${JSON.stringify(mcpSave?.annotations)}`
    )
  }

  for (const cliTool of cliByName.values()) {
    if (cliTool.kind !== 'tool') continue
    const expected = {}
    if (typeof cliTool.effects?.readOnly === 'boolean') {
      expected.readOnlyHint = cliTool.effects.readOnly
    }
    if (typeof cliTool.effects?.idempotent === 'boolean') {
      expected.idempotentHint = cliTool.effects.idempotent
    }
    const actual = mcpByName.get(cliTool.name)?.annotations ?? {}
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `MCP ${cliTool.name} annotations did not match declared effects: ${JSON.stringify({ expected, actual })}`
      )
    }
  }
}
