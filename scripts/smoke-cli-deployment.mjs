import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageManagerMatch = /^pnpm@(.+)$/.exec(rootPackage.packageManager ?? '')
if (!packageManagerMatch) {
  throw new Error('Root package.json must pin pnpm through packageManager.')
}

const pinnedPnpmVersion = packageManagerMatch[1]
const pnpmCommand =
  process.env.npm_execpath && /(?:^|[\\/])pnpm(?:\.cjs)?$/.test(process.env.npm_execpath)
    ? { command: process.execPath, prefix: [process.env.npm_execpath] }
    : { command: 'pnpm', prefix: [] }

function runPnpm(args, options = {}) {
  const result = spawnSync(pnpmCommand.command, [...pnpmCommand.prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} failed with exit code ${result.status}${
        options.capture ? `\n${result.stderr}` : ''
      }`
    )
  }
  return result.stdout?.trim() ?? ''
}

function assertNoFinanceCoreRuntimeImport(file) {
  const source = readFileSync(file, 'utf8')
  if (source.includes('@shikin/finance-core')) {
    throw new Error(`${file} retains a runtime @shikin/finance-core import.`)
  }
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `node ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr}`
    )
  }
  return result.stdout.trim()
}

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

function waitForDataServer(child, getStderr) {
  return new Promise((resolveReady, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onData = (chunk) => {
      if (!chunk.includes('Listening on')) return
      cleanup()
      resolveReady()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `App data server exited before readiness with code ${code} signal ${signal ?? 'none'}\n${getStderr()}`
        )
      )
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`App data server readiness timed out.\n${getStderr()}`))
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode }

  child.kill('SIGTERM')
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit({ code: child.exitCode, signal: child.signalCode })
    }, 3_000)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

async function requestHostedApi(port, path, body, options = {}) {
  const origin = options.origin ?? `http://127.0.0.1:${port}`
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(origin ? { origin } : {}),
      ...(options.headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

function assertPackagedWebAssets(webRoot) {
  const indexPath = join(webRoot, 'index.html')
  if (!existsSync(indexPath)) throw new Error('Deployed CLI package omitted web/index.html.')

  const index = readFileSync(indexPath, 'utf8')
  const assetPaths = [...index.matchAll(/(?:src|href)="([^"?#]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/assets/'))
  if (assetPaths.length === 0)
    throw new Error('Packaged web/index.html does not reference any assets.')

  for (const assetPath of assetPaths) {
    if (!existsSync(join(webRoot, assetPath))) {
      throw new Error(`Packaged web asset is missing: ${assetPath}`)
    }
  }

  return assetPaths
}

async function snapshotHostedTables(port) {
  const tables = await requestHostedApi(port, '/api/db/query', {
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    params: [],
  })
  const snapshot = {}

  for (const { name } of tables) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Hosted database returned an invalid table name: ${JSON.stringify(name)}`)
    }
    const escapedName = name.replaceAll('"', '""')
    snapshot[name] = await requestHostedApi(port, '/api/db/query', {
      sql: `SELECT * FROM "${escapedName}"`,
      params: [],
    })
  }

  return snapshot
}

function changedTables(before, after) {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .sort()
}

function assertSameSnapshot(before, after, label) {
  const changed = changedTables(before, after)
  if (changed.length > 0) {
    throw new Error(`${label} changed database table contents: ${changed.join(', ')}`)
  }
}

function assertAutomationCatalog(cliCatalog, mcpTools) {
  if (cliCatalog.toolCount !== 108 || cliCatalog.commandCount !== 113) {
    throw new Error(
      `Deployed catalog counts were ${cliCatalog.toolCount} tools / ${cliCatalog.commandCount} commands; expected 108 / 113.`
    )
  }
  if (cliCatalog.compatibility?.effects?.declaredOnly !== true) {
    throw new Error(
      `CLI catalog did not mark effects as declared-only: ${JSON.stringify(cliCatalog.compatibility)}`
    )
  }

  const cliByName = new Map((cliCatalog.commands ?? []).map((command) => [command.name, command]))
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
    'list-card-statement-payment-links': { readOnly: true },
  }
  for (const [name, effects] of Object.entries(expectedEffects)) {
    if (JSON.stringify(cliByName.get(name)?.effects) !== JSON.stringify(effects)) {
      throw new Error(`CLI ${name} effects were invalid: ${JSON.stringify(cliByName.get(name))}`)
    }
  }
  if (cliByName.get('list-accounts')?.effects !== undefined) {
    throw new Error('CLI catalog claimed effects for unaudited list-accounts.')
  }
  if (cliByName.get('add-transaction')?.effects !== undefined) {
    throw new Error('CLI catalog claimed effects for unaudited add-transaction.')
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

function parseMcpTextResult(result, toolName) {
  const textContent = result?.content?.find((item) => item?.type === 'text')
  if (!textContent || typeof textContent.text !== 'string') {
    throw new Error(`${toolName} returned no MCP text content: ${JSON.stringify(result)}`)
  }

  try {
    return JSON.parse(textContent.text)
  } catch (error) {
    throw new Error(
      `${toolName} returned invalid JSON text: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function formatError(error) {
  return error instanceof Error ? error.stack || error.message : String(error)
}

async function withTimeout(promise, label, timeoutMs = 10_000) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function smokeMcp({
  cliEntrypoint,
  entrypoint,
  packageFile,
  env,
  port,
  fixture,
  runtimeIdentityPath,
}) {
  const requireFromDeployedCli = createRequire(packageFile)
  const clientModulePath = requireFromDeployedCli.resolve(
    '@modelcontextprotocol/sdk/client/index.js'
  )
  const stdioModulePath = requireFromDeployedCli.resolve(
    '@modelcontextprotocol/sdk/client/stdio.js'
  )
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientModulePath).href),
    import(pathToFileURL(stdioModulePath).href),
  ])

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    cwd: root,
    env,
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.setEncoding('utf8')
  transport.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000)
  })

  const client = new Client({ name: 'shikin-deployment-smoke', version: rootPackage.version })
  let operationError
  let toolCount = 0

  try {
    await client.connect(transport, { timeout: 10_000 })

    const before = await snapshotHostedTables(port)
    const cliCatalog = JSON.parse(runNode([cliEntrypoint, 'tools', '--json'], env))
    const cliTools = cliCatalog.commands?.filter((command) => command.kind === 'tool') ?? []
    if (cliCatalog.toolCount !== cliTools.length || cliTools.length === 0) {
      throw new Error(
        `Deployed CLI returned an invalid tool catalog: ${JSON.stringify(cliCatalog)}`
      )
    }

    const listed = await client.listTools(undefined, { timeout: 10_000 })
    const mcpTools = listed.tools ?? []
    toolCount = mcpTools.length
    const cliNames = cliTools.map((tool) => tool.name).sort()
    const mcpNames = mcpTools.map((tool) => tool.name).sort()
    if (new Set(mcpNames).size !== mcpNames.length) {
      throw new Error(`MCP returned duplicate tool names: ${JSON.stringify(mcpNames)}`)
    }
    if (JSON.stringify(mcpNames) !== JSON.stringify(cliNames)) {
      throw new Error(
        `CLI/MCP tool catalog mismatch. CLI=${JSON.stringify(cliNames)} MCP=${JSON.stringify(mcpNames)}`
      )
    }
    assertAutomationCatalog(cliCatalog, mcpTools)

    for (const tool of mcpTools) {
      if (
        !tool.inputSchema ||
        typeof tool.inputSchema !== 'object' ||
        Array.isArray(tool.inputSchema) ||
        Object.keys(tool.inputSchema).length === 0
      ) {
        throw new Error(`MCP tool ${tool.name} has an empty input schema.`)
      }
      if (tool.inputSchema.type !== 'object') {
        throw new Error(`MCP tool ${tool.name} input schema is not an object schema.`)
      }
    }

    rmSync(runtimeIdentityPath, { force: true })
    const cliRuntime = JSON.parse(
      runNode([cliEntrypoint, 'get-runtime-diagnostics', '--json'], env)
    )
    const mcpRuntimeResult = await client.callTool(
      { name: 'get-runtime-diagnostics', arguments: {} },
      undefined,
      { timeout: 10_000 }
    )
    if (mcpRuntimeResult.isError) {
      throw new Error(`MCP get-runtime-diagnostics failed: ${JSON.stringify(mcpRuntimeResult)}`)
    }
    const mcpRuntime = parseMcpTextResult(mcpRuntimeResult, 'get-runtime-diagnostics')
    const expectedRuntimeKeys = [
      'build',
      'dataRevision',
      'databaseLineageId',
      'lastFinancialWriteAt',
      'localInstance',
      'schemaMigration',
      'schemaVersion',
      'success',
      'version',
    ]
    for (const [surface, result] of [
      ['CLI', cliRuntime],
      ['MCP', mcpRuntime],
    ]) {
      if (
        result.success !== true ||
        JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expectedRuntimeKeys)
      ) {
        throw new Error(
          `${surface} runtime diagnostics contract drifted: ${JSON.stringify(result)}`
        )
      }
      const serialized = JSON.stringify(result)
      if (
        serialized.includes(env.XDG_DATA_HOME) ||
        serialized.includes(env.HOME) ||
        /"[^"}]*(?:path|directory|filename)[^"}]*"\s*:/i.test(serialized)
      ) {
        throw new Error(`${surface} runtime diagnostics exposed a filesystem path.`)
      }
    }
    if (existsSync(runtimeIdentityPath)) {
      throw new Error('Runtime diagnostics initialized the missing runtime identity sidecar.')
    }

    const cliAccounts = JSON.parse(runNode([cliEntrypoint, 'list-accounts', '--json'], env))
    const cliFixture = cliAccounts.accounts?.find((account) => account.id === fixture.accountId)
    if (!cliFixture) {
      throw new Error(`CLI list-accounts did not return fixture ${fixture.accountId}.`)
    }

    const listAccountsResult = await client.callTool(
      { name: 'list-accounts', arguments: {} },
      undefined,
      { timeout: 10_000 }
    )
    if (listAccountsResult.isError) {
      throw new Error(`MCP list-accounts failed: ${JSON.stringify(listAccountsResult)}`)
    }
    const mcpAccounts = parseMcpTextResult(listAccountsResult, 'list-accounts')
    const mcpFixture = mcpAccounts.accounts?.find((account) => account.id === fixture.accountId)
    if (!mcpFixture || mcpFixture.id !== cliFixture.id) {
      throw new Error(
        `CLI and MCP did not read the same fixture account ID ${fixture.accountId}: ${JSON.stringify({ cliFixture, mcpFixture })}`
      )
    }

    const transactionsResult = await client.callTool(
      {
        name: 'query-transactions',
        arguments: { accountId: fixture.accountId, limit: 10 },
      },
      undefined,
      { timeout: 10_000 }
    )
    if (transactionsResult.isError) {
      throw new Error(`MCP query-transactions failed: ${JSON.stringify(transactionsResult)}`)
    }
    const transactions = parseMcpTextResult(transactionsResult, 'query-transactions')
    const cliTransactions = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'query-transactions',
          '--account-id',
          fixture.accountId,
          '--limit',
          '10',
          '--json',
        ],
        env
      )
    )
    for (const [surface, result] of [
      ['CLI', cliTransactions],
      ['MCP', transactions],
    ]) {
      if (
        result.success !== true ||
        result.totalMatched !== 1 ||
        result.transactions?.length !== 1 ||
        result.transactions[0].id !== fixture.transactionId
      ) {
        throw new Error(
          `${surface} did not return the seeded transaction: ${JSON.stringify(result)}`
        )
      }
    }

    const importPreview = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'import-transactions',
          '--file',
          fixture.importFile,
          '--account-id',
          fixture.accountId,
          '--source',
          'deployment-smoke-import',
          '--json',
        ],
        env
      )
    )
    if (
      importPreview.success !== true ||
      importPreview.dryRun !== true ||
      importPreview.applyRequired !== true ||
      typeof importPreview.previewToken !== 'string' ||
      importPreview.previewToken.length === 0
    ) {
      throw new Error(`Unexpected import preview/token payload: ${JSON.stringify(importPreview)}`)
    }

    const correctionPreview = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'correct-transaction-metadata',
          '--transaction-id',
          fixture.transactionId,
          '--description',
          'CLI deployment smoke corrected preview',
          '--audit-source',
          'deployment-smoke',
          '--audit-note',
          'Preview correction contract',
          '--dry-run',
          '--json',
        ],
        env
      )
    )
    if (correctionPreview.success !== true || correctionPreview.dryRun !== true) {
      throw new Error(`Unexpected correction preview payload: ${JSON.stringify(correctionPreview)}`)
    }

    const coverageReadResult = await client.callTool(
      { name: 'list-source-coverage', arguments: { accountId: fixture.accountId } },
      undefined,
      { timeout: 10_000 }
    )
    if (coverageReadResult.isError) {
      throw new Error(`MCP list-source-coverage failed: ${JSON.stringify(coverageReadResult)}`)
    }
    const coverageRead = parseMcpTextResult(coverageReadResult, 'list-source-coverage')
    if (coverageRead.success !== true || !Array.isArray(coverageRead.coverage)) {
      throw new Error(`Unexpected coverage read payload: ${JSON.stringify(coverageRead)}`)
    }

    const cliDryRun = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'add-transaction',
          '--account-id',
          fixture.accountId,
          '--category',
          fixture.categoryName,
          '--amount',
          '12.34',
          '--type',
          'expense',
          '--description',
          'CLI deployment smoke dry run',
          '--date',
          '2026-01-15',
          '--dry-run',
          '--json',
        ],
        env
      )
    )
    if (
      cliDryRun.success !== true ||
      cliDryRun.dryRun !== true ||
      cliDryRun.wouldCreate?.accountId !== fixture.accountId
    ) {
      throw new Error(`Unexpected CLI dry-run payload: ${JSON.stringify(cliDryRun)}`)
    }

    const schemaInvalidResult = await client.callTool(
      { name: 'query-transactions', arguments: { limit: 0 } },
      undefined,
      { timeout: 10_000 }
    )
    const schemaInvalidText = schemaInvalidResult.content?.find(
      (item) => item?.type === 'text'
    )?.text
    if (
      schemaInvalidResult.isError !== true ||
      typeof schemaInvalidText !== 'string' ||
      !schemaInvalidText.toLowerCase().includes('validation')
    ) {
      throw new Error(
        `MCP schema-invalid error result was unstable: ${JSON.stringify(schemaInvalidResult)}`
      )
    }

    const domainInvalidResult = await client.callTool(
      {
        name: 'add-transaction',
        arguments: {
          accountId: fixture.accountId,
          category: 'Missing MCP Smoke Category',
          amount: 12.34,
          type: 'expense',
          description: 'MCP deployment smoke invalid category',
          date: '2026-01-15',
          dryRun: true,
        },
      },
      undefined,
      { timeout: 10_000 }
    )
    const domainInvalidPayload = parseMcpTextResult(
      domainInvalidResult,
      'add-transaction invalid category'
    )
    if (
      domainInvalidResult.isError !== true ||
      domainInvalidPayload.success !== false ||
      domainInvalidPayload.errorType !== 'execution_error' ||
      typeof domainInvalidPayload.error !== 'string' ||
      domainInvalidPayload.error.length === 0 ||
      domainInvalidPayload.error !== domainInvalidPayload.message
    ) {
      throw new Error(
        `MCP domain-invalid error envelope was unstable: ${JSON.stringify(domainInvalidResult)}`
      )
    }

    const dryRunResult = await client.callTool(
      {
        name: 'add-transaction',
        arguments: {
          accountId: fixture.accountId,
          category: fixture.categoryName,
          amount: 12.34,
          type: 'expense',
          description: 'MCP deployment smoke dry run',
          date: '2026-01-15',
          dryRun: true,
        },
      },
      undefined,
      { timeout: 10_000 }
    )
    if (dryRunResult.isError) {
      throw new Error(`MCP add-transaction dry run failed: ${JSON.stringify(dryRunResult)}`)
    }
    const dryRun = parseMcpTextResult(dryRunResult, 'add-transaction dry run')
    if (
      dryRun.success !== true ||
      dryRun.dryRun !== true ||
      dryRun.wouldCreate?.accountId !== fixture.accountId ||
      dryRun.wouldCreate?.category !== fixture.categoryName
    ) {
      throw new Error(`Unexpected add-transaction dry-run payload: ${JSON.stringify(dryRun)}`)
    }

    const recapInput = { type: 'monthly', period: fixture.transactionDate }
    const cliRecap = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'get-spending-recap',
          '--type',
          recapInput.type,
          '--period',
          recapInput.period,
          '--json',
        ],
        env
      )
    )
    if (cliRecap.success !== true || cliRecap.complete !== true || !cliRecap.recap) {
      throw new Error(`CLI get-spending-recap failed: ${JSON.stringify(cliRecap)}`)
    }

    const mcpRecapResult = await client.callTool(
      { name: 'get-spending-recap', arguments: recapInput },
      undefined,
      { timeout: 10_000 }
    )
    if (mcpRecapResult.isError) {
      throw new Error(`MCP get-spending-recap failed: ${JSON.stringify(mcpRecapResult)}`)
    }
    const mcpRecap = parseMcpTextResult(mcpRecapResult, 'get-spending-recap')
    if (mcpRecap.success !== true || mcpRecap.complete !== true || !mcpRecap.recap) {
      throw new Error(`MCP get-spending-recap payload failed: ${JSON.stringify(mcpRecap)}`)
    }

    const afterReads = await snapshotHostedTables(port)
    assertSameSnapshot(before, afterReads, 'CLI/MCP reads, recap generation, or financial dry runs')

    const cliSave = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'save-spending-recap',
          '--type',
          recapInput.type,
          '--period',
          recapInput.period,
          '--json',
        ],
        env
      )
    )
    if (cliSave.success !== true || cliSave.saved !== true || !cliSave.recap) {
      throw new Error(`CLI save-spending-recap failed: ${JSON.stringify(cliSave)}`)
    }

    const afterCliSave = await snapshotHostedTables(port)
    const cliSaveChanges = changedTables(before, afterCliSave)
    if (JSON.stringify(cliSaveChanges) !== JSON.stringify(['audit_log', 'recaps'])) {
      throw new Error(
        `CLI save-spending-recap changed unexpected tables: ${cliSaveChanges.join(', ') || '(none)'}`
      )
    }
    if (
      JSON.stringify(afterCliSave.accounts) !== JSON.stringify(before.accounts) ||
      JSON.stringify(afterCliSave.transactions) !== JSON.stringify(before.transactions)
    ) {
      throw new Error('CLI save-spending-recap changed ledger or account tables.')
    }

    const mcpSaveResult = await client.callTool(
      { name: 'save-spending-recap', arguments: recapInput },
      undefined,
      { timeout: 10_000 }
    )
    if (mcpSaveResult.isError) {
      throw new Error(`MCP save-spending-recap failed: ${JSON.stringify(mcpSaveResult)}`)
    }
    const mcpSave = parseMcpTextResult(mcpSaveResult, 'save-spending-recap')
    if (mcpSave.success !== true || mcpSave.saved !== true) {
      throw new Error(`MCP save-spending-recap payload failed: ${JSON.stringify(mcpSave)}`)
    }

    const afterMcpSave = await snapshotHostedTables(port)
    assertSameSnapshot(afterCliSave, afterMcpSave, 'Identical MCP save-spending-recap')
    if (
      JSON.stringify(afterMcpSave.accounts) !== JSON.stringify(before.accounts) ||
      JSON.stringify(afterMcpSave.transactions) !== JSON.stringify(before.transactions)
    ) {
      throw new Error('MCP save-spending-recap changed ledger or account tables.')
    }

    const beforeCorrection = await snapshotHostedTables(port)
    const correctionResult = await client.callTool(
      {
        name: 'correct-transaction-metadata',
        arguments: {
          transactionId: fixture.transactionId,
          description: 'MCP deployment smoke corrected',
          auditSource: 'deployment-smoke',
          auditNote: 'Exercise audited metadata correction',
        },
      },
      undefined,
      { timeout: 10_000 }
    )
    if (correctionResult.isError) {
      throw new Error(
        `MCP correct-transaction-metadata failed: ${JSON.stringify(correctionResult)}`
      )
    }
    const correction = parseMcpTextResult(correctionResult, 'correct-transaction-metadata')
    if (correction.success !== true || !correction.transaction) {
      throw new Error(`Unexpected metadata correction payload: ${JSON.stringify(correction)}`)
    }
    const afterCorrection = await snapshotHostedTables(port)
    if (JSON.stringify(afterCorrection.accounts) !== JSON.stringify(beforeCorrection.accounts)) {
      throw new Error('Metadata correction changed account rows.')
    }
    const correctedRows = await requestHostedApi(port, '/api/db/query', {
      sql: 'SELECT description FROM transactions WHERE id = $1',
      params: [fixture.transactionId],
    })
    if (correctedRows[0]?.description !== 'MCP deployment smoke corrected') {
      throw new Error(`Metadata correction was not persisted: ${JSON.stringify(correctedRows)}`)
    }

    const setCoverage = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'set-source-coverage',
          '--account-id',
          fixture.accountId,
          '--source-namespace',
          'deployment-smoke-import',
          '--period-start',
          '2026-01-01',
          '--period-end',
          '2026-01-31',
          '--status',
          'verified',
          '--zero-rows',
          '--document-ref',
          'synthetic deployment smoke statement',
          '--source',
          'deployment-smoke',
          '--note',
          'Synthetic isolated coverage evidence',
          '--json',
        ],
        env
      )
    )
    if (setCoverage.success !== true || typeof setCoverage.coverage?.id !== 'string') {
      throw new Error(`CLI set-source-coverage failed: ${JSON.stringify(setCoverage)}`)
    }
    const listedCoverageResult = await client.callTool(
      {
        name: 'list-source-coverage',
        arguments: {
          accountId: fixture.accountId,
          sourceNamespace: 'deployment-smoke-import',
        },
      },
      undefined,
      { timeout: 10_000 }
    )
    if (listedCoverageResult.isError) {
      throw new Error(`MCP coverage read failed: ${JSON.stringify(listedCoverageResult)}`)
    }
    const listedCoverage = parseMcpTextResult(listedCoverageResult, 'list-source-coverage')
    if (
      listedCoverage.success !== true ||
      listedCoverage.coverage?.length !== 1 ||
      listedCoverage.coverage[0].id !== setCoverage.coverage.id
    ) {
      throw new Error(`Coverage CLI/MCP parity failed: ${JSON.stringify(listedCoverage)}`)
    }

    const card = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'create-account',
          '--name',
          'Payment Evidence Smoke Card',
          '--type',
          'credit_card',
          '--currency',
          'MXN',
          '--json',
        ],
        env
      )
    )
    if (card.success !== true || typeof card.account?.id !== 'string') {
      throw new Error(`Could not create payment smoke card: ${JSON.stringify(card)}`)
    }
    const statement = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'create-credit-card-statement',
          '--account-id',
          card.account.id,
          '--statement-start-date',
          '2026-01-01',
          '--statement-end-date',
          '2026-01-31',
          '--due-date',
          '2026-02-20',
          '--statement-balance',
          '25',
          '--minimum-payment',
          '5',
          '--source',
          'deployment-smoke',
          '--json',
        ],
        env
      )
    )
    if (statement.success !== true || typeof statement.statement?.id !== 'string') {
      throw new Error(`Could not create payment smoke statement: ${JSON.stringify(statement)}`)
    }
    const payment = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'add-transaction',
          '--account-id',
          fixture.accountId,
          '--transfer-to-account-id',
          card.account.id,
          '--amount',
          '25',
          '--type',
          'transfer',
          '--description',
          'Synthetic statement payment evidence',
          '--date',
          '2026-02-10',
          '--source',
          'deployment-smoke',
          '--json',
        ],
        env
      )
    )
    if (payment.success !== true || typeof payment.transaction?.id !== 'string') {
      throw new Error(`Could not create payment transaction evidence: ${JSON.stringify(payment)}`)
    }

    const beforePaymentLink = await snapshotHostedTables(port)
    const linkResult = await client.callTool(
      {
        name: 'link-card-statement-payment',
        arguments: {
          statementId: statement.statement.id,
          transactionId: payment.transaction.id,
          amount: 25,
          mode: 'apply_to_unpaid',
          auditSource: 'deployment-smoke',
          auditNote: 'Link exact synthetic transfer evidence',
        },
      },
      undefined,
      { timeout: 10_000 }
    )
    if (linkResult.isError) {
      throw new Error(`MCP link-card-statement-payment failed: ${JSON.stringify(linkResult)}`)
    }
    const linked = parseMcpTextResult(linkResult, 'link-card-statement-payment')
    if (
      linked.success !== true ||
      linked.balanceImpact?.affectsBalances !== false ||
      typeof linked.link?.id !== 'string'
    ) {
      throw new Error(`Unexpected payment link payload: ${JSON.stringify(linked)}`)
    }
    const afterPaymentLink = await snapshotHostedTables(port)
    if (
      JSON.stringify(afterPaymentLink.accounts) !== JSON.stringify(beforePaymentLink.accounts) ||
      JSON.stringify(afterPaymentLink.transactions) !==
        JSON.stringify(beforePaymentLink.transactions)
    ) {
      throw new Error('Payment linking changed accounts or transactions.')
    }

    const unlinked = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'unlink-card-statement-payment',
          '--link-id',
          linked.link.id,
          '--audit-source',
          'deployment-smoke',
          '--audit-note',
          'Unlink synthetic transfer evidence',
          '--json',
        ],
        env
      )
    )
    if (unlinked.success !== true || unlinked.balanceImpact?.affectsBalances !== false) {
      throw new Error(`CLI unlink-card-statement-payment failed: ${JSON.stringify(unlinked)}`)
    }
    const afterPaymentUnlink = await snapshotHostedTables(port)
    if (
      JSON.stringify(afterPaymentUnlink.accounts) !== JSON.stringify(beforePaymentLink.accounts) ||
      JSON.stringify(afterPaymentUnlink.transactions) !==
        JSON.stringify(beforePaymentLink.transactions)
    ) {
      throw new Error('Payment unlinking changed accounts or transactions.')
    }
  } catch (error) {
    operationError = error
  }

  let closeError
  try {
    await withTimeout(client.close(), 'MCP client close', 5_000)
  } catch (error) {
    closeError = error
  }
  try {
    await withTimeout(transport.close(), 'MCP stdio transport close', 5_000)
  } catch (error) {
    closeError ??= error
  }

  if (operationError || closeError) {
    throw new Error(
      [
        operationError ? formatError(operationError) : null,
        closeError ? `MCP close failed: ${formatError(closeError)}` : null,
        stderr ? `MCP stderr:\n${stderr}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  return toolCount
}

async function smokeHostedWeb(
  cliEntrypoint,
  mcpEntrypoint,
  packageFile,
  deployedWebRoot,
  isolatedEnv,
  runtimeIdentityPath
) {
  const packagedAssets = assertPackagedWebAssets(deployedWebRoot)
  const port = await findAvailablePort()
  const child = spawn(process.execPath, [cliEntrypoint, 'web', '--port', String(port)], {
    cwd: root,
    env: isolatedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  try {
    await waitForDataServer(child, () => stderr)

    for (const path of ['/', '/settings']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(10_000),
      })
      const html = await response.text()
      if (!response.ok || !html.includes('<div id="root">')) {
        throw new Error(`Hosted web path ${path} did not serve the production SPA.`)
      }
    }
    for (const assetPath of packagedAssets) {
      const response = await fetch(`http://127.0.0.1:${port}${assetPath}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        throw new Error(`Hosted web asset ${assetPath} did not serve successfully.`)
      }
    }

    const created = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'create-account',
          '--name',
          'CLI Shared DB Smoke',
          '--type',
          'checking',
          '--currency',
          'MXN',
          '--json',
        ],
        isolatedEnv
      )
    )
    if (
      created?.account?.name !== 'CLI Shared DB Smoke' ||
      typeof created.account.id !== 'string' ||
      created.account.id.length === 0
    ) {
      throw new Error(`Unexpected deployed CLI create response: ${JSON.stringify(created)}`)
    }

    const webRows = await requestHostedApi(port, '/api/db/query', {
      sql: 'SELECT name, currency FROM accounts WHERE name = $1',
      params: ['CLI Shared DB Smoke'],
    })
    if (webRows.length !== 1 || webRows[0].currency !== 'MXN') {
      throw new Error(`Hosted web API did not observe the CLI account: ${JSON.stringify(webRows)}`)
    }

    await requestHostedApi(port, '/api/db/execute', {
      sql: 'INSERT INTO categories (id, name, type, sort_order) VALUES ($1, $2, $3, $4)',
      params: ['shared-smoke-category', 'Web Shared DB Smoke', 'expense', 999],
    })
    const categories = JSON.parse(
      runNode([cliEntrypoint, 'list-categories', '--json'], isolatedEnv)
    )
    if (!categories.categories?.some((category) => category.name === 'Web Shared DB Smoke')) {
      throw new Error(`CLI did not observe the hosted web category: ${JSON.stringify(categories)}`)
    }

    // This is a committed fixture write in the disposable database, before the
    // read/dry-run preservation baseline. Nonempty queries must return its exact ID.
    const recorded = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'add-transaction',
          '--account-id',
          created.account.id,
          '--category',
          'Web Shared DB Smoke',
          '--amount',
          '7.50',
          '--type',
          'expense',
          '--description',
          'CLI deployment smoke fixture',
          '--date',
          '2026-01-15',
          '--json',
        ],
        isolatedEnv
      )
    )
    if (
      recorded.success !== true ||
      typeof recorded.transaction?.id !== 'string' ||
      !recorded.transaction.id
    ) {
      throw new Error(
        `Could not create the synthetic transaction fixture: ${JSON.stringify(recorded)}`
      )
    }

    const wrongOrigin = await fetch(`http://127.0.0.1:${port}/api/db/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://wrong-origin.example',
      },
      body: JSON.stringify({ sql: 'SELECT 1', params: [] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (wrongOrigin.status !== 403) {
      throw new Error(`Hosted web API accepted a wrong Origin with status ${wrongOrigin.status}.`)
    }

    const importFile = join(isolatedEnv.TMPDIR, 'deployment-smoke-import.csv')
    writeFileSync(
      importFile,
      'date,description,amount,externalId\n2026-01-16,Synthetic import preview,8.25,smoke-import-001\n'
    )

    return await smokeMcp({
      cliEntrypoint,
      entrypoint: mcpEntrypoint,
      packageFile,
      env: isolatedEnv,
      port,
      runtimeIdentityPath,
      fixture: {
        accountId: created.account.id,
        transactionId: recorded.transaction.id,
        categoryName: 'Web Shared DB Smoke',
        transactionDate: '2026-01-15',
        importFile,
      },
    })
  } finally {
    const stopped = await stopChild(child)
    if (stopped.code !== 0 || stopped.signal !== null) {
      throw new Error(
        `Hosted web server did not stop cleanly (code ${stopped.code}, signal ${stopped.signal ?? 'none'}).`
      )
    }
  }
}

const actualPnpmVersion = runPnpm(['--version'], { capture: true })
if (actualPnpmVersion !== pinnedPnpmVersion) {
  throw new Error(`Expected pnpm ${pinnedPnpmVersion}, received ${actualPnpmVersion}.`)
}

const tempRoot = mkdtempSync(join(tmpdir(), 'shikin-cli-deploy-smoke-'))
try {
  const deployDir = join(tempRoot, 'cli-support')
  const syntheticRoots = {
    home: join(tempRoot, 'home'),
    userProfile: join(tempRoot, 'user-profile'),
    appData: join(tempRoot, 'app-data'),
    localAppData: join(tempRoot, 'local-app-data'),
    xdgData: join(tempRoot, 'xdg-data'),
    xdgConfig: join(tempRoot, 'xdg-config'),
    xdgCache: join(tempRoot, 'xdg-cache'),
    temp: join(tempRoot, 'tmp'),
  }
  for (const directory of Object.values(syntheticRoots)) {
    mkdirSync(directory, { recursive: true })
  }

  runPnpm(['--dir', 'cli', 'build'])
  runPnpm(['--filter', '@shikin/cli', 'deploy', '--prod', deployDir])

  const packageFile = join(deployDir, 'package.json')
  const cliEntrypoint = join(deployDir, 'dist', 'cli.js')
  const mcpEntrypoint = join(deployDir, 'dist', 'mcp-server.js')
  const deployedWebRoot = join(deployDir, 'web')
  const requiredPaths = [
    packageFile,
    cliEntrypoint,
    mcpEntrypoint,
    join(deployedWebRoot, 'index.html'),
    join(deployDir, 'node_modules'),
  ]
  for (const requiredPath of requiredPaths) {
    try {
      readFileSync(requiredPath)
    } catch (error) {
      if (requiredPath.endsWith('node_modules')) {
        // Directories cannot be read as files; checking a known production dependency proves usability.
        readFileSync(join(requiredPath, 'better-sqlite3', 'package.json'))
      } else {
        throw error
      }
    }
  }

  assertNoFinanceCoreRuntimeImport(cliEntrypoint)
  assertNoFinanceCoreRuntimeImport(mcpEntrypoint)

  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => value !== undefined && !name.startsWith('SHIKIN_')
    )
  )
  const isolatedEnv = {
    ...inheritedEnv,
    HOME: syntheticRoots.home,
    USERPROFILE: syntheticRoots.userProfile,
    APPDATA: syntheticRoots.appData,
    LOCALAPPDATA: syntheticRoots.localAppData,
    XDG_DATA_HOME: syntheticRoots.xdgData,
    XDG_CONFIG_HOME: syntheticRoots.xdgConfig,
    XDG_CACHE_HOME: syntheticRoots.xdgCache,
    TMPDIR: syntheticRoots.temp,
    TMP: syntheticRoots.temp,
    TEMP: syntheticRoots.temp,
    SHIKIN_RESPECT_XDG_DATA_HOME:
      process.platform === 'darwin' || process.platform === 'win32' ? '0' : '1',
  }
  const version = runNode([cliEntrypoint, '--version'], isolatedEnv)
  if (version !== rootPackage.version) {
    throw new Error(`Deployed CLI reported version ${version}; expected ${rootPackage.version}.`)
  }
  const runtimeAppDataDir =
    process.platform === 'win32'
      ? join(syntheticRoots.appData, 'com.asf.shikin')
      : process.platform === 'darwin'
        ? join(syntheticRoots.home, 'Library', 'Application Support', 'com.asf.shikin')
        : join(syntheticRoots.xdgData, 'com.asf.shikin')
  const mcpToolCount = await smokeHostedWeb(
    cliEntrypoint,
    mcpEntrypoint,
    packageFile,
    deployedWebRoot,
    isolatedEnv,
    join(runtimeAppDataDir, 'runtime-identity.json')
  )

  console.log(
    `Packaged CLI/MCP ${mcpToolCount}-tool catalog parity and representative import, correction, coverage, payment-link, runtime-read, recap, and hosted-web workflows passed with pnpm ${actualPnpmVersion}.`
  )
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
