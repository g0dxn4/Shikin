import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

// Run this SAME harness against a pinned baseline checkout and the candidate.
// All tool requests use real MCP SDK transport; all databases are synthetic.
const args = process.argv.slice(2)
let repo = fileURLToPath(new URL('../', import.meta.url))
let output
let iterations = 7
for (let index = 0; index < args.length; index++) {
  const value = args[index + 1]
  if (args[index] === '--repo' && value) {
    repo = resolve(value)
    index++
  } else if (args[index] === '--output' && value) {
    output = resolve(value)
    index++
  } else if (args[index] === '--iterations' && value && /^\d+$/.test(value)) {
    iterations = Number(value)
    index++
  } else
    throw new Error('Usage: benchmark-mcp.mjs [--repo PATH] [--output PATH] [--iterations 1..30]')
}
if (iterations < 1 || iterations > 30) throw new Error('iterations must be 1..30')
const syntheticRoot = await mkdtemp(join(tmpdir(), 'shikin-mcp-benchmark-'))
process.env.XDG_DATA_HOME = syntheticRoot
process.env.SHIKIN_RESPECT_XDG_DATA_HOME = '1'
process.env.SHIKIN_MIGRATE_LEGACY_DATA = '0'
// Avoid loading installed user plugins or reading user data even for schema discovery.
const appDir = join(syntheticRoot, 'com.asf.shikin')
await mkdir(appDir)
process.env.SHIKIN_EXTENSIONS_DIR = join(appDir, 'extensions')
await mkdir(process.env.SHIKIN_EXTENSIONS_DIR)
const dbPath = join(appDir, 'shikin.db')
const requireRepo = createRequire(join(repo, 'cli/package.json'))
const targetRoot = await realpath(repo)
const financeCoreEntry = relative(
  targetRoot,
  await realpath(requireRepo.resolve('@shikin/finance-core'))
)
if (financeCoreEntry.startsWith('..') || isAbsolute(financeCoreEntry)) {
  throw new Error(
    'finance-core resolves outside the target checkout. Install and build the target independently before comparing it.'
  )
}
const packageVersion = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version
const sourceFiles = [
  'package.json',
  'cli/package.json',
  'packages/finance-core/package.json',
  'pnpm-lock.yaml',
  'scripts/data-server.mjs',
]
async function collectSourceFiles(directory, paths = sourceFiles) {
  for (const entry of await readdir(join(repo, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) await collectSourceFiles(path, paths)
    else if (entry.isFile()) paths.push(path)
  }
}
for (const directory of ['cli/src', 'packages/finance-core/src', 'src-tauri/migrations']) {
  await collectSourceFiles(directory)
}
async function digestFiles(paths) {
  const digest = createHash('sha256')
  for (const path of paths.sort()) {
    const contents = await readFile(join(repo, path))
    digest.update(`${path}\0${contents.length}\0`).update(contents)
  }
  return digest.digest('hex')
}
const measuredSourceSha256 = await digestFiles(sourceFiles)
const builtCoreFiles = []
await collectSourceFiles('packages/finance-core/dist', builtCoreFiles)
const builtCoreJavaScript = builtCoreFiles.filter((path) => /\.[cm]?js$/.test(path))
if (builtCoreJavaScript.length === 0) throw new Error('Build finance-core before benchmarking.')
const builtFinanceCoreSha256 = await digestFiles(builtCoreJavaScript)
const harnessSha256 = createHash('sha256')
  .update(await readFile(fileURLToPath(import.meta.url)))
  .digest('hex')
let sourceRevision = null
try {
  sourceRevision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  // Source archives may not contain Git metadata; record that explicitly.
}
const load = (path) => import(pathToFileURL(join(repo, path)).href)
const loadDependency = (name) => import(pathToFileURL(requireRepo.resolve(name)).href)
const [
  { Client },
  { InMemoryTransport },
  { default: Database },
  { createMcpServer },
  { builtInTools },
  database,
  { runHostedTestMigrations },
] = await Promise.all([
  loadDependency('@modelcontextprotocol/sdk/client/index.js'),
  loadDependency('@modelcontextprotocol/sdk/inMemory.js'),
  loadDependency('better-sqlite3'),
  load('cli/src/mcp-server.ts'),
  load('cli/src/tools.ts'),
  load('cli/src/database.ts'),
  load('cli/src/backend-foundation-test-schema.ts'),
])
const toolNames = new Set(builtInTools.map((tool) => tool.name))
const modern = toolNames.has('batch-correct-transactions')
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
async function connect(options) {
  const constructionStart = performance.now()
  const server = createMcpServer(builtInTools, options)
  const constructionEnd = performance.now()
  const client = new Client({ name: 'shikin-synthetic-benchmark', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const start = performance.now()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const initialized = performance.now()
  const catalog = await client.listTools()
  const listed = performance.now()
  return {
    server,
    client,
    catalog,
    constructionMs: constructionEnd - constructionStart,
    initializeMs: initialized - start,
    listMs: listed - initialized,
  }
}
const profiles = []
const wireCatalogs = {}
for (const options of modern
  ? [
      { profile: 'full', readOnly: false },
      { profile: 'core', readOnly: false },
      { profile: 'full', readOnly: true },
      { profile: 'core', readOnly: true },
    ]
  : [{ profile: 'full', readOnly: false }]) {
  const samples = []
  let catalog
  for (let i = 0; i < iterations; i++) {
    const connection = await connect(options)
    catalog = connection.catalog
    samples.push({
      constructionMs: connection.constructionMs,
      initializeMs: connection.initializeMs,
      listMs: connection.listMs,
    })
    await connection.client.close()
    await connection.server.close()
  }
  const key = `${options.profile}${options.readOnly ? '-read-only' : ''}`
  wireCatalogs[key] = catalog
  profiles.push({
    ...options,
    toolCount: catalog.tools.length,
    schemaBytes: Buffer.byteLength(JSON.stringify(catalog)),
    schemaCharacters: JSON.stringify(catalog).length,
    constructionMedianMs: median(samples.map((sample) => sample.constructionMs)),
    initializeMedianMs: median(samples.map((sample) => sample.initializeMs)),
    listMedianMs: median(samples.map((sample) => sample.listMs)),
    samples,
  })
}
const connection = await connect({ profile: 'full', readOnly: false })
let metrics
async function call(name, input, allowError = false) {
  const start = performance.now()
  metrics.toolCalls++
  let response
  try {
    response = await connection.client.callTool({ name, arguments: input })
  } catch (error) {
    metrics.toolErrors++
    throw error
  } finally {
    metrics.executionMs += performance.now() - start
  }
  metrics.responseWireBytes += Buffer.byteLength(JSON.stringify(response))
  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  metrics.responseTextBytes += Buffer.byteLength(content)
  let result
  try {
    result = response.structuredContent ?? JSON.parse(content)
  } catch (error) {
    metrics.toolErrors++
    throw new Error(`${name}: response is not a structured or JSON financial result`, {
      cause: error,
    })
  }
  const failed = response.isError || result.success === false
  if (failed) metrics.toolErrors++
  if (failed && !allowError)
    throw new Error(`${name}: ${result.message ?? result.error ?? content}`)
  return result
}
function rows(table) {
  return database.query(`SELECT * FROM ${table} ORDER BY id`)
}
function bankEvidence() {
  return database.query(
    'SELECT id,account_id,amount,currency,date,source,note,import_source,import_external_id FROM transactions ORDER BY id'
  )
}
function readSnapshot() {
  return Object.fromEntries(
    ['transactions', 'transaction_splits', 'accounts', 'audit_log', 'app_data_state'].map(
      (table) => [table, rows(table)]
    )
  )
}
async function seed() {
  database.close()
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    await rm(`${dbPath}${suffix}`, { force: true })
  const fixture = new Database(dbPath)
  fixture.pragma('foreign_keys = ON')
  runHostedTestMigrations(fixture)
  fixture.exec(`
    INSERT INTO accounts (id,name,type,currency,balance) VALUES ('checking','Synthetic Checking','checking','MXN',0),('savings','Synthetic Savings','savings','MXN',0);
    INSERT INTO categories (id,name,type) VALUES ('shopping','Benchmark Shopping','expense'),('home','Benchmark Home','expense'),('income','Benchmark Income','income');
    INSERT INTO subcategories(id,category_id,name) VALUES ('cleaning','home','Benchmark Cleaning');
    INSERT INTO budgets(id,name,category_id,amount,currency,period,basis,scope_json) VALUES ('home-budget','Synthetic Home Budget','home',100000,'MXN','monthly','gross_cashflow','{"categoryIds":["home"]}');
  `)
  const insert =
    fixture.prepare(`INSERT INTO transactions (id,account_id,category_id,type,amount,currency,description,date,status,source,note,import_source,import_external_id)
    VALUES (?,?,?,?,?,'MXN',?,?,'posted','synthetic-bank','immutable synthetic bank evidence','benchmark',?)`)
  for (let index = 0; index < 10; index++)
    insert.run(
      `amazon-${index}`,
      'checking',
      'shopping',
      'expense',
      10000,
      `Amazon synthetic ${index}`,
      '2026-09-15',
      `amazon-id-${index}`
    )
  insert.run(
    'household',
    'checking',
    'home',
    'expense',
    20000,
    'Household split purchase',
    '2026-09-12',
    'household-id'
  )
  insert.run(
    'refund',
    'checking',
    'income',
    'income',
    3000,
    'Partial refund',
    '2026-09-20',
    'refund-id'
  )
  insert.run('july', 'checking', 'home', 'expense', 7000, 'July groceries', '2026-07-10', 'july-id')
  insert.run(
    'august',
    'checking',
    'home',
    'expense',
    8000,
    'August groceries',
    '2026-08-10',
    'august-id'
  )
  insert.run(
    'transfer-out',
    'checking',
    null,
    'expense',
    25000,
    'Internal transfer debit',
    '2026-09-10',
    'transfer-out-id'
  )
  insert.run(
    'transfer-in',
    'savings',
    null,
    'income',
    25000,
    'Internal transfer credit',
    '2026-09-10',
    'transfer-in-id'
  )
  insert.run(
    'payment-1',
    'checking',
    'income',
    'income',
    50000,
    'Client installment one',
    '2026-09-21',
    'client-1'
  )
  insert.run(
    'payment-2',
    'checking',
    'income',
    'income',
    150000,
    'Client installment two',
    '2026-09-25',
    'client-2'
  )
  fixture.exec(
    "INSERT INTO transaction_consumption_classifications(id,transaction_id,role) VALUES ('purchase-classification','household','purchase')"
  )
  fixture.close()
}
const scenarios = []
async function scenario(id, title, run) {
  const samples = []
  for (let index = 0; index < iterations; index++) {
    await seed()
    metrics = {
      toolCalls: 0,
      executionMs: 0,
      responseTextBytes: 0,
      responseWireBytes: 0,
      toolErrors: 0,
    }
    const start = performance.now()
    try {
      const detail = await run()
      samples.push({ outcome: 'passed', ...metrics, totalMs: performance.now() - start, detail })
    } catch (error) {
      samples.push({
        outcome: error.unsupported ? 'unsupported' : 'failed',
        ...metrics,
        totalMs: performance.now() - start,
        detail: error.message,
      })
    }
  }
  const failed = samples.find((sample) => sample.outcome === 'failed')
  const unsupported = samples.find((sample) => sample.outcome === 'unsupported')
  const representative = failed ?? unsupported ?? samples[0]
  scenarios.push({
    id,
    title,
    outcome: representative.outcome,
    ...Object.fromEntries(
      [
        'toolCalls',
        'executionMs',
        'responseTextBytes',
        'responseWireBytes',
        'toolErrors',
        'totalMs',
      ].map((key) => [key, median(samples.map((sample) => sample[key]))])
    ),
    detail: representative.detail,
    samples,
  })
}
async function correct(corrections, key) {
  if (modern) {
    const preview = await call('batch-correct-transactions', { corrections })
    return call('batch-correct-transactions', {
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: key,
    })
  }
  for (const correction of corrections)
    await call('correct-transaction-metadata', { ...correction, dryRun: true })
  for (const correction of corrections)
    await call('correct-transaction-metadata', { ...correction, dryRun: false })
}
try {
  await scenario(1, 'Categorize ten Amazon purchases', async () => {
    const before = bankEvidence()
    const balances = rows('accounts')
    await correct(
      Array.from({ length: 10 }, (_, index) => ({
        transactionId: `amazon-${index}`,
        categoryId: 'home',
        subcategoryId: 'cleaning',
      })),
      'amazon-ten'
    )
    assert.equal(
      database.query(
        "SELECT COUNT(*) AS count FROM transactions WHERE id LIKE 'amazon-%' AND category_id='home' AND subcategory_id='cleaning'"
      )[0].count,
      10
    )
    assert.deepEqual(bankEvidence(), before)
    assert.deepEqual(rows('accounts'), balances)
    return 'All ten corrected; bank evidence and balances unchanged. Both paths include complete previews.'
  })
  await scenario(2, 'Split a household purchase', async () => {
    const before = bankEvidence()
    await correct(
      [
        {
          transactionId: 'amazon-0',
          splits: [
            { categoryId: 'home', amountCentavos: 6000 },
            { categoryId: 'shopping', amountCentavos: 4000 },
          ],
        },
      ],
      'split'
    )
    assert.equal(
      database.query(
        "SELECT SUM(amount) AS total FROM transaction_splits WHERE transaction_id='amazon-0'"
      )[0].total,
      10000
    )
    assert.deepEqual(
      database.query(
        "SELECT category_id,subcategory_id,amount FROM transaction_splits WHERE transaction_id='amazon-0' ORDER BY category_id"
      ),
      [
        { category_id: 'home', subcategory_id: null, amount: 6000 },
        { category_id: 'shopping', subcategory_id: null, amount: 4000 },
      ]
    )
    assert.deepEqual(bankEvidence(), before)
    return 'Split allocations sum exactly to original bank amount.'
  })
  await scenario(3, 'Link a partial refund', async () => {
    const before = bankEvidence()
    const allocations = [
      {
        transactionId: 'refund',
        builtinRole: 'refund',
        referencedPurchaseId: 'purchase-classification',
      },
    ]
    const preview = await call('preview-consumption-classifications', { allocations })
    await call('apply-consumption-classifications', {
      allocations,
      previewToken: preview.previewToken,
    })
    assert.deepEqual(
      database.query(
        "SELECT transaction_id,split_id,role,referenced_purchase_id FROM transaction_consumption_classifications WHERE transaction_id='refund'"
      ),
      [
        {
          transaction_id: 'refund',
          split_id: null,
          role: 'refund',
          referenced_purchase_id: 'purchase-classification',
        },
      ]
    )
    assert.deepEqual(bankEvidence(), before)
    return 'Existing allocation-level refund workflow reused; no parent bank changes.'
  })
  await scenario(4, 'Correct historical budget without losing original', async () => {
    if (!toolNames.has('record-budget-history'))
      throw Object.assign(
        new Error('Original catalog has no immutable monthly budget-history workflow.'),
        { unsupported: true }
      )
    const request = {
      budgetId: 'home-budget',
      month: '2026-09',
      expectedRevision: 0,
      idempotencyKey: 'history-capture',
      reason: 'Synthetic retrospective capture',
      timeZone: 'UTC',
    }
    const preview = await call('record-budget-history', { ...request, dryRun: true })
    await call('record-budget-history', {
      ...request,
      dryRun: false,
      expectedToken: preview.previewToken,
      expectedDataRevision: preview.history.sourceState.dataRevision,
    })
    const originalCapture = rows('budget_history_revisions')[0]
    await call('upsert-budget', { budgetId: 'home-budget', amount: 2000 })
    const correction = {
      ...request,
      expectedRevision: 1,
      idempotencyKey: 'history-correction',
      reason: 'Synthetic correction of original limit',
      correction: { amount: 1200 },
    }
    const correctionPreview = await call('record-budget-history', correction)
    await call('record-budget-history', {
      ...correction,
      dryRun: false,
      expectedToken: correctionPreview.previewToken,
      expectedDataRevision: correctionPreview.history.sourceState.dataRevision,
    })
    const history = await call('get-budget-history', {
      budgetId: 'home-budget',
      includeRevisions: true,
    })
    assert.equal(history.history.length, 2)
    assert.equal(
      history.history.find((row) => row.revision === 1).configuration.amountCentavos,
      100000
    )
    assert.equal(
      history.history.find((row) => row.revision === 2).configuration.amountCentavos,
      120000
    )
    assert.equal(history.history.find((row) => row.revision === 1).gross.amountCentavos, 20000)
    assert.equal(history.history.find((row) => row.revision === 1).gross.remainingCentavos, 80000)
    assert.equal(history.history.find((row) => row.revision === 2).gross.remainingCentavos, 100000)
    const stored = rows('budget_history_revisions')
    assert.equal(stored.length, 2)
    assert.deepEqual(
      stored.find((row) => row.revision === 1),
      originalCapture
    )
    assert.equal(
      database.query("SELECT amount FROM budgets WHERE id='home-budget'")[0].amount,
      200000
    )
    assert.equal(
      history.history.find((row) => row.revision === 1).kind,
      'retrospective_reconstruction'
    )
    assert.equal(history.history.find((row) => row.revision === 1).retrospective, true)
    assert.equal(history.history.find((row) => row.revision === 2).kind, 'correction')
    return 'Two immutable revisions survive live-budget changes; reconstruction explicitly labeled.'
  })
  await scenario(5, 'Analyze several months of spending', async () => {
    const result = await call('get-spending-summary', {
      start: '2026-07-01',
      end: '2026-09-30',
      groupBy: 'month',
      scope: { categoryIds: ['home'] },
      currency: 'MXN',
      timeZone: 'UTC',
    })
    assert.equal(result.success, true)
    assert.equal(result.report.totals.expenseCentavos, 35000)
    assert.equal(result.totalExpenses, 350)
    assert.deepEqual(
      result.report.groups.map((group) => ({
        month: group.key,
        expenseCentavos: group.totals.expenseCentavos,
      })),
      [
        { month: '2026-07', expenseCentavos: 7000 },
        { month: '2026-08', expenseCentavos: 8000 },
        { month: '2026-09', expenseCentavos: 20000 },
      ]
    )
    return 'Existing shared scoped report covers three calendar months.'
  })
  await scenario(6, 'Reconcile internal transfers', async () => {
    const balances = rows('accounts')
    const input = { sourceTransactionId: 'transfer-out', mirrorTransactionId: 'transfer-in' }
    await call('match-transfer-transactions', input)
    await call('match-transfer-transactions', { ...input, apply: true })
    assert.equal(
      database.query("SELECT type FROM transactions WHERE id='transfer-out'")[0].type,
      'transfer'
    )
    assert.equal(
      database.query("SELECT is_archived FROM transactions WHERE id='transfer-in'")[0].is_archived,
      1
    )
    assert.deepEqual(
      rows('accounts').map(({ updated_at, ...row }) => row),
      balances.map(({ updated_at, ...row }) => row)
    )
    return 'One transfer plus archived mirror evidence; balances preserved.'
  })
  await scenario(7, 'Track annual subscription planning', async () => {
    const before = bankEvidence()
    await call('create-subscription', {
      name: 'Synthetic Annual Plan',
      amount: 1200,
      currency: 'MXN',
      accountId: 'checking',
      categoryId: 'home',
      billingCycle: 'yearly',
      nextBillingDate: '2026-12-01',
    })
    const listed = await call('list-subscriptions', {})
    assert.equal(listed.subscriptions[0].billingCycle, 'yearly')
    assert.equal(listed.subscriptions[0].monthlyAmount, 100)
    assert.equal(listed.subscriptions[0].yearlyAmount, 1200)
    assert.equal(listed.summary.monthlyTotal, 100)
    assert.deepEqual(bankEvidence(), before)
    assert.equal(rows('subscriptions')[0].amount, 120000)
    return 'Annual plan stored; no fictional monthly transaction or duplicated spending.'
  })
  await scenario(8, 'Record partial client payments', async () => {
    const created = await call('manage-receivable', {
      action: 'create',
      payer: 'Synthetic Client',
      amount: 2000,
      currency: 'MXN',
      dueDate: '2026-09-30',
      accountId: 'checking',
      apply: true,
    })
    const receivableId = created.receivable.id
    const before = bankEvidence()
    const first = await call('match-receivable', { receivableId, transactionId: 'payment-1' }, true)
    if (first.success === false)
      throw Object.assign(new Error(`Partial receipt rejected: ${first.reason ?? first.message}`), {
        unsupported: !modern && first.reason === 'payment_amount_mismatch',
      })
    await call('match-receivable', {
      receivableId,
      transactionId: 'payment-1',
      apply: true,
      ...(modern ? { expectedToken: first.token } : {}),
    })
    assert.equal(rows('receivables')[0].received_amount, 50000)
    assert.equal(rows('receivables')[0].status, 'partial')
    const second = await call('match-receivable', { receivableId, transactionId: 'payment-2' })
    await call('match-receivable', {
      receivableId,
      transactionId: 'payment-2',
      apply: true,
      ...(modern ? { expectedToken: second.token } : {}),
    })
    assert.equal(rows('receivables')[0].received_amount, 200000)
    assert.equal(rows('receivables')[0].status, 'received')
    assert.deepEqual(bankEvidence(), before)
    return 'Two installments settle expected income without creating income transactions.'
  })
  await scenario(9, 'Detect duplicate statement import', async () => {
    const file = join(syntheticRoot, 'synthetic-import.csv')
    await writeFile(
      file,
      'date,description,amount,externalId\n2026-09-28,Synthetic import duplicate,11.25,unique-statement-id\n'
    )
    const input = { file, accountId: 'checking', source: 'benchmark-import' }
    const preview = await call('import-transactions', input)
    await call('import-transactions', { ...input, apply: true, previewToken: preview.previewToken })
    const before = readSnapshot()
    const repeated = await call('import-transactions', input)
    assert.equal(repeated.summary.importedRows, 0)
    assert.equal(repeated.summary.skippedRows, 1)
    assert.equal(repeated.rows[0].status, 'idempotent')
    assert.deepEqual(readSnapshot(), before)
    await call('import-transactions', {
      ...input,
      apply: true,
      previewToken: repeated.previewToken,
    })
    assert.equal(
      database.query(
        "SELECT COUNT(*) AS count FROM transactions WHERE import_source='benchmark-import' AND import_external_id='unique-statement-id'"
      )[0].count,
      1
    )
    assert.deepEqual(
      bankEvidence(),
      before.transactions.map(
        ({
          id,
          account_id,
          amount,
          currency,
          date,
          source,
          note,
          import_source,
          import_external_id,
        }) => ({
          id,
          account_id,
          amount,
          currency,
          date,
          source,
          note,
          import_source,
          import_external_id,
        })
      )
    )
    assert.deepEqual(rows('accounts'), before.accounts)
    return 'Duplicate explicitly detected as idempotent; reviewed repeated import creates no transaction and leaves bank evidence/balances unchanged.'
  })
  await scenario(10, 'Recover from failed and repeated batch operations', async () => {
    if (!modern)
      throw Object.assign(
        new Error(
          'Original per-transaction corrections have no atomic multi-transaction retry receipt.'
        ),
        { unsupported: true }
      )
    const corrections = [
      { transactionId: 'amazon-0', categoryId: 'home' },
      { transactionId: 'amazon-1', categoryId: 'home' },
    ]
    const preview = await call('batch-correct-transactions', { corrections })
    database.execute(
      `CREATE TRIGGER benchmark_reject_audit BEFORE INSERT ON audit_log WHEN NEW.entity_id='amazon-1' AND NEW.action='correct-metadata' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`
    )
    const before = readSnapshot()
    const input = {
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: 'failure-retry',
    }
    const failed = await call('batch-correct-transactions', input, true)
    assert.equal(failed.success, false)
    assert.deepEqual(readSnapshot(), before)
    database.execute('DROP TRIGGER benchmark_reject_audit')
    await call('batch-correct-transactions', input)
    assert.deepEqual(
      database.query(
        "SELECT id,category_id FROM transactions WHERE id IN ('amazon-0','amazon-1') ORDER BY id"
      ),
      [
        { id: 'amazon-0', category_id: 'home' },
        { id: 'amazon-1', category_id: 'home' },
      ]
    )
    assert.deepEqual(
      database.query(
        "SELECT entity_id FROM audit_log WHERE entity='transaction' AND action='correct-metadata' ORDER BY entity_id"
      ),
      [{ entity_id: 'amazon-0' }, { entity_id: 'amazon-1' }]
    )
    assert.equal(
      database.query(
        "SELECT COUNT(*) AS count FROM audit_log WHERE entity='operation' AND action='batch-correct-transactions'"
      )[0].count,
      1
    )
    const after = readSnapshot()
    const repeated = await call('batch-correct-transactions', input)
    assert.equal(repeated.replayed, true)
    assert.deepEqual(readSnapshot(), after)
    return 'Injected audit failure rolls back whole batch; retry commits once; repeated delivery returns receipt.'
  })
} finally {
  await connection.client.close()
  await connection.server.close()
  database.close()
  await rm(syntheticRoot, { recursive: true, force: true })
}
const report = {
  schemaVersion: 'shikin.mcp-benchmark.v1',
  capturedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  source: {
    revision: sourceRevision,
    packageVersion,
    financeCoreEntry,
    measuredSourceSha256,
    measuredSourceFileCount: sourceFiles.length,
    builtFinanceCoreSha256,
    builtFinanceCoreFileCount: builtCoreJavaScript.length,
    builtDigestScope:
      'Same sorted path/length/content algorithm applied to actual packages/finance-core/dist JavaScript files, whose exports are executed by the tools.',
    digestScope:
      'Sorted paths, NUL, byte length, NUL, and file bytes for cli/src, packages/finance-core/src, src-tauri/migrations, package manifests, pnpm-lock.yaml and scripts/data-server.mjs.',
    harnessSha256,
    note: 'revision identifies the checkout parent; an uncommitted candidate can include working-tree changes. The raw catalogs identify the measured surface.',
  },
  methodology: {
    transport: 'MCP SDK InMemoryTransport',
    database: 'new isolated synthetic SQLite per task sample',
    iterations,
    repetitions:
      'Each profile and each task is repeated iterations times. Reported numerical task metrics are medians; all raw samples are retained. Any failing sample fails the scenario.',
    taskProfile:
      'Full compatibility profile in both versions; core discovery is measured separately. Advanced tasks may need full and are not claimed as core successes.',
    taskSelection:
      'Scripted valid tool requests starting with known fixture IDs; deterministic contract checks, not live LLM tool selection.',
    latency:
      'Local in-process protocol/handler timings; excludes model inference, network and user approval.',
    initialization:
      'Server construction/registration, warm protocol handshake, and tools/list are timed separately after module imports. Does not measure total process startup, module/schema definition evaluation, native binding load, or first financial query.',
    tokens:
      'Schema UTF-8 bytes and characters measured here. Optional measure-mcp-schema-tokens.py counts exact catalog JSON with a pinned named tokenizer in a separate artifact. Actual provider token consumption is not measured.',
    responseMetrics:
      'responseTextBytes counts JSON text content. responseWireBytes counts serialized CallToolResult JSON, excluding JSON-RPC envelopes and transport framing; structuredContent duplicates fallback text in this payload.',
    comparison:
      'Use this same harness with --repo pointing to baseline and candidate checkouts. Unsupported original features are reported explicitly.',
  },
  profiles,
  scenarios,
  totals: {
    passed: scenarios.filter((item) => item.outcome === 'passed').length,
    unsupported: scenarios.filter((item) => item.outcome === 'unsupported').length,
    failed: scenarios.filter((item) => item.outcome === 'failed').length,
  },
  catalogs: wireCatalogs,
}
if (output) {
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    {
      profiles: profiles.map(({ samples, ...profile }) => profile),
      scenarios,
      totals: report.totals,
    },
    null,
    2
  )
)
if (report.totals.failed > 0) process.exitCode = 1
