import {
  accountValuationDeclaration,
  assertObservationDate,
  type ValuationDeclaration,
} from '@shikin/finance-core/reconciliation'
import {
  accountReconciliationTools,
  reconcileTransactionalAccountBalance,
  previewTransactionalAccountBalance,
} from './account-reconciliation.js'
import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  assetCode,
  isoDate,
  moneyAmount,
  nonNegativeMoneyAmount,
  getAccountAliases,
  isAccountWriteEligible,
  normalizeAccountAlias,
  normalizeCurrencyCode,
  removeAccountAliasesForAccount,
  resolveAccountId,
  setAccountAlias,
  validateAccountAlias,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type AccountRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
  is_archived: number
  credit_limit: number | null
  statement_closing_day: number | null
  payment_due_day: number | null
  account_mode: 'transactional' | 'snapshot_only'
  valuation_mode: ValuationDeclaration
  icon?: string | null
  color?: string | null
}

type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'cash'
  | 'investment'
  | 'crypto'
  | 'other'

type AccountUpsertMatch =
  | { success: true; account: AccountRow; matchedBy: 'accountId' | 'account' | 'alias' | 'name' }
  | { success: true; account: null; matchedBy: 'new'; createName: string; createId?: string }
  | { success: false; message: string }

type CategoryRow = {
  id: string
  name: string
  type: string
  color: string | null
}

function accountAuditSnapshot(account: AccountRow) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    balance: fromCentavos(account.balance),
    balanceCentavos: account.balance,
    isArchived: Boolean(account.is_archived),
    creditLimit: account.credit_limit === null ? null : fromCentavos(account.credit_limit),
    creditLimitCentavos: account.credit_limit,
    statementClosingDay: account.statement_closing_day,
    paymentDueDay: account.payment_due_day,
    accountMode: account.account_mode ?? 'transactional',
    valuationMode: accountValuationDeclaration({
      type: account.type,
      accountMode: account.account_mode,
      valuationMode: account.valuation_mode,
    }),
    icon: account.icon ?? null,
    color: account.color ?? null,
  }
}

function accountBalanceAuditSnapshot(balanceCentavos: number) {
  return {
    balanceCentavos,
    balance: fromCentavos(balanceCentavos),
  }
}

function accountUpdateAuditPayload(account: AccountRow, balanceChanged: boolean) {
  return {
    account: accountAuditSnapshot(account),
    ...(balanceChanged ? { balance: accountBalanceAuditSnapshot(account.balance) } : {}),
  }
}

function upsertBalanceSnapshot(accountId: string, date: string, balanceCentavos: number) {
  const id = generateId()
  execute(
    `INSERT INTO account_balance_history (id, account_id, date, balance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(account_id, date) DO UPDATE SET
       balance = excluded.balance,
       created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [id, accountId, date, balanceCentavos]
  )

  return {
    id,
    accountId,
    date,
    balance: fromCentavos(balanceCentavos),
  }
}

function accountTypeSchema() {
  return z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
}

function accountModeSchema() {
  return z.enum(['transactional', 'snapshot_only'])
}

function getAccountById(accountId: string): AccountRow | null {
  return (
    (query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [accountId]) ?? [])[0] ??
    null
  )
}

function archivedAccountResult(account: AccountRow) {
  return {
    success: false as const,
    message: `Account "${account.name}" (${account.id}) is archived. Unarchive it before using it for new writes.`,
  }
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

function accountCurrencyChangeBlockedMessage(
  referenceCount: number,
  evidenceCounts?: { reconciliationCount: number; coverageCount: number }
) {
  const evidenceDetails =
    evidenceCounts && (evidenceCounts.reconciliationCount > 0 || evidenceCounts.coverageCount > 0)
      ? ` Counts: account reconciliations=${evidenceCounts.reconciliationCount}, source coverage=${evidenceCounts.coverageCount}.`
      : ''
  return `Cannot change this account currency while ${referenceCount} linked monetary reference${referenceCount === 1 ? '' : 's'} still point at the account. Create a new account or explicitly migrate the referenced data so amounts do not silently change meaning.${evidenceDetails}`
}

function activePaymentAccountReferenceCount(accountId: string): number {
  return (
    (query<{ count: number }>(
      `SELECT COUNT(DISTINCT l.id) AS count
       FROM card_statement_payment_links l
       JOIN credit_card_statements s ON s.id = l.statement_id
       JOIN transactions t ON t.id = l.transaction_id
       WHERE l.voided_at IS NULL
         AND (s.account_id = $1 OR t.account_id = $2 OR t.transfer_to_account_id = $3)`,
      [accountId, accountId, accountId]
    ) ?? [])[0]?.count ?? 0
  )
}

function accountModeChangeFailure(
  account: AccountRow,
  nextMode: AccountRow['account_mode'] | undefined
) {
  if (!nextMode || nextMode === (account.account_mode ?? 'transactional')) return null
  const transactionCount =
    (query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE account_id = $1 OR transfer_to_account_id = $2`,
      [account.id, account.id]
    ) ?? [])[0]?.count ?? 0
  const reconciliationCount =
    (query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM account_reconciliations WHERE account_id = $1',
      [account.id]
    ) ?? [])[0]?.count ?? 0
  if (transactionCount === 0 && reconciliationCount === 0) return null
  const evidence = [
    transactionCount > 0
      ? `${transactionCount} ledger row${transactionCount === 1 ? '' : 's'}`
      : null,
    reconciliationCount > 0
      ? `${reconciliationCount} reconciliation observation${reconciliationCount === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' and ')
  return {
    success: false as const,
    reason: 'account_mode_transition_requires_new_account' as const,
    message: `Account "${account.name}" has ${evidence}. Create a new ${nextMode} account so historical and observed balance bases are not mixed.`,
  }
}

function countAccountCurrencyBlockers(sql: string, params: unknown[]): number {
  const rows = query<{ count: number }>(sql, params) as Array<{ count: number }> | undefined
  return rows?.[0]?.count ?? 0
}

function findExactNameAccount(name: string): AccountUpsertMatch {
  const matches = query<AccountRow>(
    'SELECT * FROM accounts WHERE LOWER(name) = LOWER($1) ORDER BY is_archived ASC, name ASC, id ASC LIMIT 3',
    [name]
  )
  const activeMatches = matches.filter(isAccountWriteEligible)

  if (activeMatches.length === 1) {
    return { success: true, account: activeMatches[0], matchedBy: 'name' }
  }
  if (activeMatches.length > 1) {
    return {
      success: false,
      message: `Account name "${name}" matches multiple active accounts. Use accountId or define a unique alias.`,
    }
  }
  if (matches.length > 0) {
    return archivedAccountResult(matches[0])
  }

  return { success: true, account: null, matchedBy: 'new', createName: name }
}

function resolveAccountForUpsert(input: {
  accountId?: string
  account?: string
  alias?: string
  name?: string
}): AccountUpsertMatch {
  if (input.accountId) {
    const account = getAccountById(input.accountId)
    if (account) {
      if (!isAccountWriteEligible(account)) return archivedAccountResult(account)
      return { success: true, account, matchedBy: 'accountId' }
    }

    const createName = input.name ?? input.account
    if (!createName) {
      return {
        success: false,
        message: 'name or account is required when creating an account with a new accountId.',
      }
    }
    return { success: true, account: null, matchedBy: 'new', createName, createId: input.accountId }
  }

  if (input.alias) {
    const normalizedAlias = normalizeAccountAlias(input.alias)
    const aliasedAccountId = getAccountAliases()[normalizedAlias]
    if (aliasedAccountId) {
      const account = getAccountById(aliasedAccountId)
      if (!account) {
        return {
          success: false,
          message: `Account alias "${normalizedAlias}" points to missing account ${aliasedAccountId}.`,
        }
      }
      if (!isAccountWriteEligible(account)) return archivedAccountResult(account)
      return { success: true, account, matchedBy: 'alias' }
    }
  }

  if (input.account) {
    const resolved = resolveAccountId(undefined, input.account)
    if (resolved.success) {
      const account = getAccountById(resolved.id)
      if (!account) {
        return { success: false, message: `Account ${resolved.id} not found.` }
      }
      return { success: true, account, matchedBy: 'account' }
    }

    const lowerMessage = resolved.message.toLowerCase()
    if (!lowerMessage.includes('not found')) {
      return { success: false, message: resolved.message }
    }
    return {
      success: true,
      account: null,
      matchedBy: 'new',
      createName: input.name ?? input.account,
    }
  }

  if (input.name) return findExactNameAccount(input.name)

  return {
    success: false,
    message: 'Provide accountId, account, alias, or name so upsert-account has a stable match key.',
  }
}

function accountCurrencyChangeFailure(
  accountId: string,
  currentCurrency: string,
  nextCurrency?: string
) {
  if (
    nextCurrency === undefined ||
    normalizeCurrencyCode(nextCurrency) === normalizeCurrencyCode(currentCurrency)
  ) {
    return null
  }

  const linkedTransactionCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM transactions WHERE account_id = $1 OR transfer_to_account_id = $2',
    [accountId, accountId]
  )
  const linkedRecurringRuleCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM recurring_rules WHERE account_id = $1 OR to_account_id = $2',
    [accountId, accountId]
  )
  const linkedSubscriptionCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM subscriptions WHERE account_id = $1',
    [accountId]
  )
  const linkedInvestmentCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM investments WHERE account_id = $1',
    [accountId]
  )
  const linkedStatementCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM credit_card_statements WHERE account_id = $1',
    [accountId]
  )
  const linkedBalanceHistoryCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM account_balance_history WHERE account_id = $1',
    [accountId]
  )
  const linkedGoalCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM goals WHERE account_id = $1',
    [accountId]
  )
  const linkedReconciliationCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM account_reconciliations WHERE account_id = $1',
    [accountId]
  )
  const linkedCoverageCount = countAccountCurrencyBlockers(
    'SELECT COUNT(*) as count FROM source_coverage WHERE account_id = $1',
    [accountId]
  )
  const accountRows = query<{ balance: number }>(
    'SELECT balance FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  ) as Array<{ balance: number }> | undefined
  const accountBalance = accountRows?.[0]?.balance ?? 0
  const blockingReferenceCount =
    linkedTransactionCount +
    linkedRecurringRuleCount +
    linkedSubscriptionCount +
    linkedInvestmentCount +
    linkedStatementCount +
    linkedBalanceHistoryCount +
    linkedGoalCount +
    linkedReconciliationCount +
    linkedCoverageCount +
    (accountBalance === 0 ? 0 : 1)

  return blockingReferenceCount > 0
    ? accountCurrencyChangeBlockedMessage(blockingReferenceCount, {
        reconciliationCount: linkedReconciliationCount,
        coverageCount: linkedCoverageCount,
      })
    : null
}

type AccountUpdateFields = {
  name?: string
  type?: AccountType
  currency?: string
  balance?: number
  creditLimit?: number | null
  statementClosingDay?: number | null
  paymentDueDay?: number | null
  valuationMode?: ValuationDeclaration
  icon?: string | null
  color?: string | null
  clearIcon?: boolean
  clearColor?: boolean
  clearCreditLimit?: boolean
  clearStatementClosingDay?: boolean
  clearPaymentDueDay?: boolean
  observedDate?: string
  accountMode?: AccountRow['account_mode']
}

const nullableAccountFields = [
  ['icon', 'icon', 'clearIcon'],
  ['color', 'color', 'clearColor'],
  ['creditLimit', 'credit_limit', 'clearCreditLimit'],
  ['statementClosingDay', 'statement_closing_day', 'clearStatementClosingDay'],
  ['paymentDueDay', 'payment_due_day', 'clearPaymentDueDay'],
] as const
function normalizeNullableAccountInput(input: AccountUpdateFields): AccountUpdateFields {
  if (input.observedDate) assertObservationDate(input.observedDate, dayjs().format('YYYY-MM-DD'))
  const result = { ...input }
  for (const [field, , clear] of nullableAccountFields) {
    if (input[clear]) {
      if (input[field] !== undefined)
        throw new Error(`${field} conflicts with ${clear}; provide one or the other.`)
      Object.assign(result, { [field]: null })
    }
  }
  return result
}

function prepareAccountUpdate(
  account: AccountRow,
  input: AccountUpdateFields,
  onlyChangedValues: boolean
) {
  input = normalizeNullableAccountInput(input)
  if (
    input.type !== undefined &&
    input.type !== account.type &&
    activePaymentAccountReferenceCount(account.id) > 0
  ) {
    throw new Error('Unlink active card-statement payments before changing this account type.')
  }
  if (
    input.type &&
    input.type !== account.type &&
    ['investment', 'crypto'].includes(input.type) &&
    input.valuationMode === undefined
  ) {
    throw new Error('Changing to a portfolio account requires explicit valuationMode.')
  }
  const currentMode = account.account_mode ?? 'transactional'
  const nextMode = input.accountMode ?? currentMode
  const requestedBalanceCentavos =
    input.balance !== undefined ? toCentavos(input.balance) : account.balance
  const updatedAccount: AccountRow = {
    ...account,
    name: input.name ?? account.name,
    type: input.type ?? account.type,
    currency: input.currency ?? account.currency,
    balance: requestedBalanceCentavos,
    credit_limit:
      input.creditLimit !== undefined
        ? input.creditLimit === null
          ? null
          : toCentavos(input.creditLimit)
        : account.credit_limit,
    statement_closing_day:
      input.statementClosingDay === undefined
        ? account.statement_closing_day
        : input.statementClosingDay,
    payment_due_day:
      input.paymentDueDay === undefined ? account.payment_due_day : input.paymentDueDay,
    account_mode: nextMode,
    valuation_mode:
      input.valuationMode ??
      accountValuationDeclaration({
        type: account.type,
        accountMode: currentMode,
        valuationMode: account.valuation_mode,
      }),
    icon: input.icon === undefined ? account.icon : input.icon,
    color: input.color === undefined ? account.color : input.color,
  }
  const setClauses: string[] = []
  const params: unknown[] = []
  let paramIdx = 1
  const addSet = (column: string, value: unknown) => {
    setClauses.push(`${column} = $${paramIdx++}`)
    params.push(value)
  }
  const shouldSet = (provided: boolean, changed: boolean) =>
    provided && (!onlyChangedValues || changed)

  if (shouldSet(input.name !== undefined, input.name !== account.name)) {
    addSet('name', input.name)
  }
  if (shouldSet(input.type !== undefined, input.type !== account.type)) {
    addSet('type', input.type)
  }
  if (shouldSet(input.accountMode !== undefined, input.accountMode !== currentMode)) {
    addSet('account_mode', input.accountMode)
  }
  if (
    shouldSet(
      input.currency !== undefined,
      normalizeCurrencyCode(input.currency) !== normalizeCurrencyCode(account.currency)
    )
  ) {
    addSet('currency', input.currency)
  }
  if (
    nextMode === 'snapshot_only' &&
    shouldSet(input.balance !== undefined, requestedBalanceCentavos !== account.balance)
  ) {
    addSet('balance', requestedBalanceCentavos)
  } else if (
    currentMode === 'snapshot_only' &&
    nextMode === 'transactional' &&
    account.balance !== 0
  ) {
    addSet('balance', 0)
  }
  for (const [field, column] of nullableAccountFields) {
    const value = input[field]
    const storedValue =
      field === 'creditLimit' && typeof value === 'number' ? toCentavos(value) : value
    if (shouldSet(value !== undefined, storedValue !== account[column])) addSet(column, storedValue)
  }
  if (
    shouldSet(input.valuationMode !== undefined, input.valuationMode !== account.valuation_mode)
  ) {
    addSet(
      'valuation_mode',
      accountValuationDeclaration({ type: updatedAccount.type, valuationMode: input.valuationMode })
    )
  }

  const needsBalanceReconciliation =
    nextMode === 'transactional' &&
    (currentMode === 'snapshot_only'
      ? requestedBalanceCentavos !== 0 || requestedBalanceCentavos !== account.balance
      : input.balance !== undefined &&
        (requestedBalanceCentavos !== account.balance || input.observedDate !== undefined))

  const reconciliationPlan = needsBalanceReconciliation
    ? previewTransactionalAccountBalance(account.id, requestedBalanceCentavos, input.observedDate)
    : null
  if (reconciliationPlan) updatedAccount.balance = reconciliationPlan.currentBalanceAfter
  return {
    reconciliationPlan,
    updatedAccount,
    setClauses,
    params,
    nextParamIdx: paramIdx,
    requestedBalanceCentavos,
    needsBalanceReconciliation,
  }
}

const listAccounts: ToolDefinition = {
  name: 'list-accounts',
  description:
    'List all active accounts. Use this when the user asks about their accounts, balances, or needs to pick an account.',
  schema: z.object({
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .describe('Filter by account type'),
  }),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM accounts WHERE is_archived = 0'

    if (type) {
      sql += ' AND type = $1'
      params.push(type)
    }

    sql += ' ORDER BY name'

    const accounts = await query<AccountRow>(sql, params)
    const aliasEntries = Object.entries(getAccountAliases())
    const aliasesByAccount = aliasEntries.reduce<Record<string, string[]>>(
      (acc, [alias, accountId]) => {
        acc[accountId] = [...(acc[accountId] ?? []), alias]
        return acc
      },
      {}
    )

    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        aliases: aliasesByAccount[a.id] ?? [],
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: fromCentavos(a.balance),
        accountMode: a.account_mode ?? 'transactional',
        valuationMode: accountValuationDeclaration({
          type: a.type,
          accountMode: a.account_mode,
          valuationMode: a.valuation_mode,
        }),
      })),
      message:
        accounts.length === 0
          ? 'No accounts found.'
          : `Found ${accounts.length} account${accounts.length !== 1 ? 's' : ''}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 7. create-account
// ---------------------------------------------------------------------------
const createAccount: ToolDefinition = {
  name: 'create-account',
  description:
    'Create a new financial account. Use this when the user wants to add a bank account, credit card, cash wallet, or other account.',
  schema: z.object({
    name: boundedText(
      'Account name',
      'Account name (e.g. "Chase Checking", "BBVA Credit Card")',
      120
    ),
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .default('checking')
      .describe('Account type (default: checking)'),
    currency: assetCode('Currency or asset code (default: USD)').optional().default('USD'),
    balance: moneyAmount('Initial balance in the main currency unit (default: 0)')
      .optional()
      .default(0),
    valuationMode: z
      .enum(['cash_plus_holdings', 'portfolio_snapshot', 'unresolved'])
      .optional()
      .describe('Explicit balance ownership; required for new investment/crypto accounts'),
    icon: boundedText('Icon', 'Account icon', 120).nullable().optional(),
    color: boundedText('Color', 'Account color', 120).nullable().optional(),
    clearIcon: z.boolean().optional(),
    clearColor: z.boolean().optional(),
    clearCreditLimit: z.boolean().optional(),
    clearStatementClosingDay: z.boolean().optional(),
    clearPaymentDueDay: z.boolean().optional(),
    observedDate: isoDate(
      'Balance observation end-of-day date; later activity is retained'
    ).optional(),
    accountMode: accountModeSchema()
      .optional()
      .default('transactional')
      .describe(
        'transactional derives balance changes from the ledger; snapshot_only uses observed valuations'
      ),
    creditLimit: nonNegativeMoneyAmount(
      'Credit limit in the main currency unit (only for credit_card type)'
    )
      .nullable()
      .optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('Day of the month payment is due (1-31, only for credit_card type)'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the account without writing it'),
  }),
  execute: async ({
    name,
    type,
    currency,
    balance,
    creditLimit,
    statementClosingDay,
    paymentDueDay,
    accountMode,
    valuationMode,
    icon,
    color,
    clearIcon,
    clearColor,
    clearCreditLimit,
    clearStatementClosingDay,
    clearPaymentDueDay,
    observedDate,
    dryRun,
  }) => {
    normalizeNullableAccountInput({
      icon,
      color,
      creditLimit,
      statementClosingDay,
      paymentDueDay,
      clearIcon,
      clearColor,
      clearCreditLimit,
      clearStatementClosingDay,
      clearPaymentDueDay,
      observedDate,
    })
    const id = generateId()
    const balanceCentavos = toCentavos(balance)
    const creditLimitCentavos =
      creditLimit !== null && creditLimit !== undefined ? toCentavos(creditLimit) : null
    const account: AccountRow = {
      id,
      name,
      type,
      currency,
      balance: balanceCentavos,
      is_archived: 0,
      credit_limit: creditLimitCentavos,
      statement_closing_day: statementClosingDay ?? null,
      payment_due_day: paymentDueDay ?? null,
      account_mode: accountMode,
      valuation_mode: accountValuationDeclaration({
        type,
        accountMode,
        valuationMode,
        creating: true,
      }),
      icon: icon ?? null,
      color: color ?? null,
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldCreate: accountAuditSnapshot(account),
        message: `Dry run: ${type} account "${name}" with balance $${fromCentavos(balanceCentavos).toFixed(2)} would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day, account_mode, valuation_mode, icon, color)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          name,
          type,
          currency,
          accountMode === 'snapshot_only' ? balanceCentavos : 0,
          creditLimitCentavos,
          statementClosingDay ?? null,
          paymentDueDay ?? null,
          accountMode,
          account.valuation_mode,
          account.icon,
          account.color,
        ]
      )
      if (accountMode === 'transactional' && balanceCentavos !== 0) {
        reconcileTransactionalAccountBalance({
          accountId: id,
          currency,
          date: observedDate,
          observedBalance: balanceCentavos,
          storedBalanceBefore: 0,
        })
      }
      writeAuditLog({
        entity: 'account',
        entityId: id,
        action: 'create',
        before: null,
        after: {
          account: accountAuditSnapshot(account),
          balanceChange: {
            previousBalanceCentavos: null,
            newBalanceCentavos: balanceCentavos,
            previousBalance: null,
            newBalance: fromCentavos(balanceCentavos),
          },
        },
      })
    })

    const parts = [
      `Created ${type} account "${name}" with balance $${fromCentavos(balanceCentavos).toFixed(2)}`,
    ]
    if (creditLimit !== null && creditLimit !== undefined)
      parts.push(`credit limit: $${creditLimit.toFixed(2)}`)
    if (statementClosingDay !== undefined) parts.push(`closing day: ${statementClosingDay}`)
    if (paymentDueDay !== undefined) parts.push(`payment due day: ${paymentDueDay}`)

    return {
      success: true,
      account: {
        id,
        name,
        type,
        currency,
        balance: fromCentavos(balanceCentavos),
        creditLimit: creditLimit ?? undefined,
        statementClosingDay: statementClosingDay ?? undefined,
        paymentDueDay: paymentDueDay ?? undefined,
        accountMode,
        valuationMode: account.valuation_mode,
        icon: account.icon,
        color: account.color,
      },
      message: parts.join(', '),
    }
  },
}

const upsertAccount: ToolDefinition = {
  name: 'upsert-account',
  description:
    'Idempotently create or update an account by accountId, account name, or account alias. Returns whether the account was created or updated.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Stable account ID to update or create', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, exact account ID, exact account name, or new account name',
      128
    ).optional(),
    alias: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(
        validateAccountAlias,
        'Alias must use letters, numbers, dots, underscores, or hyphens'
      )
      .optional()
      .describe('Friendly alias to match or assign, e.g. bbva-checking'),
    name: boundedText('Account name', 'Account name to create or set', 120).optional(),
    type: accountTypeSchema().optional().describe('Account type to create or set'),
    currency: assetCode('Currency or asset code to create or set').optional(),
    balance: moneyAmount('Account balance in the main currency unit').optional(),
    valuationMode: z
      .enum(['cash_plus_holdings', 'portfolio_snapshot', 'unresolved'])
      .optional()
      .describe('Explicit balance ownership; required for new investment/crypto accounts'),
    icon: boundedText('Icon', 'Account icon', 120).nullable().optional(),
    color: boundedText('Color', 'Account color', 120).nullable().optional(),
    clearIcon: z.boolean().optional(),
    clearColor: z.boolean().optional(),
    clearCreditLimit: z.boolean().optional(),
    clearStatementClosingDay: z.boolean().optional(),
    clearPaymentDueDay: z.boolean().optional(),
    observedDate: isoDate(
      'Balance observation end-of-day date; later activity is retained'
    ).optional(),
    accountMode: accountModeSchema().optional().describe('Account balance tracking mode'),
    creditLimit: nonNegativeMoneyAmount(
      'Credit limit in the main currency unit (only for credit_card type)'
    )
      .nullable()
      .optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('Day of the month payment is due (1-31, only for credit_card type)'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the account upsert without writing it'),
  }),
  execute: async ({
    accountId,
    account,
    alias,
    name,
    type,
    currency,
    balance,
    creditLimit,
    statementClosingDay,
    paymentDueDay,
    accountMode,
    valuationMode,
    icon,
    color,
    clearIcon,
    clearColor,
    clearCreditLimit,
    clearStatementClosingDay,
    clearPaymentDueDay,
    observedDate,
    dryRun,
  }) => {
    normalizeNullableAccountInput({
      icon,
      color,
      creditLimit,
      statementClosingDay,
      paymentDueDay,
      clearIcon,
      clearColor,
      clearCreditLimit,
      clearStatementClosingDay,
      clearPaymentDueDay,
      observedDate,
    })
    const normalizedAlias = alias ? normalizeAccountAlias(alias) : null
    const updateInput = {
      name,
      type,
      currency,
      balance,
      creditLimit,
      statementClosingDay,
      paymentDueDay,
      accountMode,
      valuationMode,
      icon,
      color,
      clearIcon,
      clearColor,
      clearCreditLimit,
      clearStatementClosingDay,
      clearPaymentDueDay,
      observedDate,
    }

    if (dryRun) {
      const match = resolveAccountForUpsert({ accountId, account, alias, name })
      if (!match.success) return match

      const existingAliasTarget = normalizedAlias ? getAccountAliases()[normalizedAlias] : null
      const intendedAliasTarget = match.account ? match.account.id : (match.createId ?? null)
      if (normalizedAlias && existingAliasTarget && existingAliasTarget !== intendedAliasTarget) {
        return {
          success: false,
          reason: 'alias_conflict',
          message: `Alias "${normalizedAlias}" already points to account ${existingAliasTarget}. Remove or choose a different alias before reassigning it.`,
        }
      }

      if (!match.account) {
        const id = match.createId ?? generateId()
        const balanceCentavos = toCentavos(balance ?? 0)
        const createdAccount: AccountRow = {
          id,
          name: name ?? match.createName,
          type: type ?? 'checking',
          currency: currency ?? 'USD',
          balance: balanceCentavos,
          is_archived: 0,
          credit_limit:
            creditLimit !== null && creditLimit !== undefined ? toCentavos(creditLimit) : null,
          statement_closing_day: statementClosingDay ?? null,
          payment_due_day: paymentDueDay ?? null,
          account_mode: accountMode ?? 'transactional',
          valuation_mode: accountValuationDeclaration({
            type: type ?? 'checking',
            accountMode,
            valuationMode,
            creating: true,
          }),
          icon: icon ?? null,
          color: color ?? null,
        }

        return {
          success: true,
          action: 'created' as const,
          dryRun: true,
          matchedBy: match.matchedBy,
          wouldCreate: accountAuditSnapshot(createdAccount),
          wouldSetAlias: normalizedAlias ? { alias: normalizedAlias, accountId: id } : null,
          message: `Dry run: account "${createdAccount.name}" would be created.`,
        }
      }

      const existing = match.account
      const currencyFailure = accountCurrencyChangeFailure(existing.id, existing.currency, currency)
      if (currencyFailure) return { success: false, message: currencyFailure }
      const modeFailure = accountModeChangeFailure(existing, accountMode)
      if (modeFailure) return modeFailure

      const prepared = prepareAccountUpdate(existing, updateInput, true)
      const aliasWouldChange = Boolean(normalizedAlias && existingAliasTarget !== existing.id)
      const changed =
        prepared.setClauses.length > 0 || prepared.needsBalanceReconciliation || aliasWouldChange
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        matchedBy: match.matchedBy,
        changed,
        wouldUpdate: {
          accountId: existing.id,
          before: accountAuditSnapshot(existing),
          after: accountAuditSnapshot(prepared.updatedAccount),
          reconciliation: prepared.reconciliationPlan,
        },
        wouldSetAlias: normalizedAlias
          ? { alias: normalizedAlias, accountId: existing.id, changed: aliasWouldChange }
          : null,
        message: `Dry run: account "${prepared.updatedAccount.name}" would be updated.`,
      }
    }

    return transaction(() => {
      const match = resolveAccountForUpsert({ accountId, account, alias, name })
      if (!match.success) return match

      const existingAliasTarget = normalizedAlias ? getAccountAliases()[normalizedAlias] : null
      if (!match.account) {
        const intendedAliasTarget = match.createId ?? null
        if (normalizedAlias && existingAliasTarget && existingAliasTarget !== intendedAliasTarget) {
          return {
            success: false,
            reason: 'alias_conflict',
            message: `Alias "${normalizedAlias}" already points to account ${existingAliasTarget}. Remove or choose a different alias before reassigning it.`,
          }
        }

        const id = match.createId ?? generateId()
        const createdType: AccountType = type ?? 'checking'
        const createdCurrency = currency ?? 'USD'
        const balanceCentavos = toCentavos(balance ?? 0)
        const creditLimitCentavos =
          creditLimit !== null && creditLimit !== undefined ? toCentavos(creditLimit) : null
        const createdAccount: AccountRow = {
          id,
          name: name ?? match.createName,
          type: createdType,
          currency: createdCurrency,
          balance: balanceCentavos,
          is_archived: 0,
          credit_limit: creditLimitCentavos,
          statement_closing_day: statementClosingDay ?? null,
          payment_due_day: paymentDueDay ?? null,
          account_mode: accountMode ?? 'transactional',
          valuation_mode: accountValuationDeclaration({
            type: type ?? 'checking',
            accountMode,
            valuationMode,
            creating: true,
          }),
          icon: icon ?? null,
          color: color ?? null,
        }

        execute(
          `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day, account_mode, valuation_mode, icon, color)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            createdAccount.name,
            createdType,
            createdCurrency,
            createdAccount.account_mode === 'snapshot_only' ? balanceCentavos : 0,
            creditLimitCentavos,
            statementClosingDay ?? null,
            paymentDueDay ?? null,
            createdAccount.account_mode,
            createdAccount.valuation_mode,
            createdAccount.icon,
            createdAccount.color,
          ]
        )
        if (createdAccount.account_mode === 'transactional' && balanceCentavos !== 0) {
          reconcileTransactionalAccountBalance({
            accountId: id,
            currency: createdCurrency,
            date: observedDate,
            observedBalance: balanceCentavos,
            storedBalanceBefore: 0,
          })
        }
        if (normalizedAlias) setAccountAlias(id, normalizedAlias)

        const finalAccount = getAccountById(id)
        if (!finalAccount || !isAccountWriteEligible(finalAccount)) {
          throw new Error(`Account ${id} could not be read safely after creation.`)
        }
        writeAuditLog({
          entity: 'account',
          entityId: id,
          action: 'create',
          before: null,
          after: {
            account: accountAuditSnapshot(finalAccount),
            balanceChange: {
              previousBalanceCentavos: null,
              newBalanceCentavos: balanceCentavos,
              previousBalance: null,
              newBalance: fromCentavos(balanceCentavos),
            },
          },
        })

        return {
          success: true,
          action: 'created' as const,
          matchedBy: match.matchedBy,
          account: accountAuditSnapshot(finalAccount),
          alias: normalizedAlias,
          message: `Created account "${finalAccount.name}".`,
        }
      }

      const existing = match.account
      const currentAccount = getAccountById(existing.id)
      if (!currentAccount) {
        return { success: false, message: `Account ${existing.id} disappeared during update.` }
      }
      if (!isAccountWriteEligible(currentAccount)) return archivedAccountResult(currentAccount)

      const currencyFailure = accountCurrencyChangeFailure(
        currentAccount.id,
        currentAccount.currency,
        currency
      )
      if (currencyFailure) return { success: false, message: currencyFailure }
      const modeFailure = accountModeChangeFailure(currentAccount, accountMode)
      if (modeFailure) return modeFailure

      const currentAliasTarget = normalizedAlias
        ? (getAccountAliases()[normalizedAlias] ?? null)
        : null
      if (normalizedAlias && currentAliasTarget && currentAliasTarget !== currentAccount.id) {
        return {
          success: false,
          reason: 'alias_conflict',
          message: `Alias "${normalizedAlias}" already points to account ${currentAliasTarget}. Remove or choose a different alias before reassigning it.`,
        }
      }

      const prepared = prepareAccountUpdate(currentAccount, updateInput, true)
      const aliasWouldChange = Boolean(normalizedAlias && currentAliasTarget !== currentAccount.id)
      const changed =
        prepared.setClauses.length > 0 || prepared.needsBalanceReconciliation || aliasWouldChange

      if (prepared.setClauses.length > 0) {
        const updateClauses = [
          ...prepared.setClauses,
          `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        ]
        assertSingleRowUpdated(
          execute(
            `UPDATE accounts SET ${updateClauses.join(', ')} WHERE id = $${prepared.nextParamIdx} AND is_archived = 0`,
            [...prepared.params, currentAccount.id]
          ),
          `Account ${currentAccount.id} could not be updated safely.`
        )
      }

      if (prepared.needsBalanceReconciliation) {
        reconcileTransactionalAccountBalance({
          accountId: currentAccount.id,
          currency: currency ?? currentAccount.currency,
          date: observedDate,
          observedBalance: prepared.requestedBalanceCentavos,
          storedBalanceBefore: currentAccount.balance,
        })
      }

      if (normalizedAlias) {
        const aliasResult = setAccountAlias(currentAccount.id, normalizedAlias)
        if (!aliasResult.success) throw new Error(aliasResult.message)
      }
      const finalAccount = getAccountById(currentAccount.id)
      if (!finalAccount || !isAccountWriteEligible(finalAccount)) {
        throw new Error(`Account ${currentAccount.id} could not be read safely after update.`)
      }
      if (changed) {
        const balanceChanged = finalAccount.balance !== currentAccount.balance
        writeAuditLog({
          entity: 'account',
          entityId: currentAccount.id,
          action: 'update',
          before: {
            ...accountUpdateAuditPayload(currentAccount, balanceChanged),
            ...(normalizedAlias
              ? { alias: { alias: normalizedAlias, changed: aliasWouldChange } }
              : {}),
          },
          after: {
            ...accountUpdateAuditPayload(finalAccount, balanceChanged),
            ...(normalizedAlias
              ? {
                  alias: {
                    alias: normalizedAlias,
                    accountId: currentAccount.id,
                    changed: aliasWouldChange,
                  },
                }
              : {}),
          },
        })
      }

      return {
        success: true,
        action: 'updated' as const,
        matchedBy: match.matchedBy,
        changed,
        account: accountAuditSnapshot(finalAccount),
        reconciliation: prepared.reconciliationPlan,
        alias: normalizedAlias,
        message: `Updated account "${finalAccount.name}".`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 8. update-account
// ---------------------------------------------------------------------------
const updateAccount: ToolDefinition = {
  name: 'update-account',
  description:
    'Update an existing account. Use this to change the name, type, currency, balance, credit limit, or billing dates of an account.',
  schema: z.object({
    accountId: boundedText('Account ID', 'The ID of the account to update', 128),
    name: boundedText('Account name', 'New account name', 120).optional(),
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .describe('New account type'),
    currency: assetCode('New currency or asset code').optional(),
    balance: moneyAmount('New balance in main currency unit').optional(),
    valuationMode: z
      .enum(['cash_plus_holdings', 'portfolio_snapshot', 'unresolved'])
      .optional()
      .describe('Explicit balance ownership; required for new investment/crypto accounts'),
    icon: boundedText('Icon', 'Account icon', 120).nullable().optional(),
    color: boundedText('Color', 'Account color', 120).nullable().optional(),
    clearIcon: z.boolean().optional(),
    clearColor: z.boolean().optional(),
    clearCreditLimit: z.boolean().optional(),
    clearStatementClosingDay: z.boolean().optional(),
    clearPaymentDueDay: z.boolean().optional(),
    observedDate: isoDate(
      'Balance observation end-of-day date; later activity is retained'
    ).optional(),
    accountMode: accountModeSchema().optional().describe('New account balance tracking mode'),
    creditLimit: nonNegativeMoneyAmount('New credit limit in main currency unit')
      .nullable()
      .optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('New statement closing day (1-31)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .describe('New payment due day (1-31)'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the account update without writing it'),
  }),
  execute: async ({
    accountId,
    name,
    type,
    currency,
    balance,
    creditLimit,
    statementClosingDay,
    paymentDueDay,
    accountMode,
    valuationMode,
    icon,
    color,
    clearIcon,
    clearColor,
    clearCreditLimit,
    clearStatementClosingDay,
    clearPaymentDueDay,
    observedDate,
    dryRun,
  }) => {
    const hasFieldsToUpdate = [
      name,
      type,
      currency,
      balance,
      creditLimit,
      statementClosingDay,
      paymentDueDay,
      accountMode,
      valuationMode,
      icon,
      color,
      clearIcon,
      clearColor,
      clearCreditLimit,
      clearStatementClosingDay,
      clearPaymentDueDay,
      observedDate,
    ].some((value) => value !== undefined)
    if (!hasFieldsToUpdate) {
      return { success: false, message: 'No fields to update.' }
    }

    const updateInput = {
      name,
      type,
      currency,
      balance,
      creditLimit,
      statementClosingDay,
      paymentDueDay,
      accountMode,
      valuationMode,
      icon,
      color,
      clearIcon,
      clearColor,
      clearCreditLimit,
      clearStatementClosingDay,
      clearPaymentDueDay,
      observedDate,
    }

    if (dryRun) {
      const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [accountId])
      if (existing.length === 0) {
        return { success: false, message: `Account ${accountId} not found.` }
      }
      const account = existing[0]
      if (!isAccountWriteEligible(account)) return archivedAccountResult(account)
      const currencyFailure = accountCurrencyChangeFailure(accountId, account.currency, currency)
      if (currencyFailure) return { success: false, message: currencyFailure }
      const modeFailure = accountModeChangeFailure(account, accountMode)
      if (modeFailure) return modeFailure
      const prepared = prepareAccountUpdate(account, updateInput, false)
      return {
        success: true,
        dryRun: true,
        wouldUpdate: {
          accountId,
          before: accountAuditSnapshot(account),
          after: accountAuditSnapshot(prepared.updatedAccount),
          reconciliation: prepared.reconciliationPlan,
        },
        message: `Dry run: account "${prepared.updatedAccount.name}" would be updated.`,
      }
    }

    return transaction(() => {
      const currentAccount = getAccountById(accountId)
      if (!currentAccount) return { success: false, message: `Account ${accountId} not found.` }
      if (!isAccountWriteEligible(currentAccount)) return archivedAccountResult(currentAccount)

      const currencyFailure = accountCurrencyChangeFailure(
        accountId,
        currentAccount.currency,
        currency
      )
      if (currencyFailure) return { success: false, message: currencyFailure }
      const modeFailure = accountModeChangeFailure(currentAccount, accountMode)
      if (modeFailure) return modeFailure

      const prepared = prepareAccountUpdate(currentAccount, updateInput, false)
      const updateClauses = [
        ...prepared.setClauses,
        `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ]
      assertSingleRowUpdated(
        execute(
          `UPDATE accounts SET ${updateClauses.join(', ')} WHERE id = $${prepared.nextParamIdx} AND is_archived = 0`,
          [...prepared.params, accountId]
        ),
        `Account ${accountId} could not be updated safely.`
      )

      if (prepared.needsBalanceReconciliation) {
        reconcileTransactionalAccountBalance({
          accountId,
          currency: currency ?? currentAccount.currency,
          date: observedDate,
          observedBalance: prepared.requestedBalanceCentavos,
          storedBalanceBefore: currentAccount.balance,
        })
      }

      const finalAccount = getAccountById(accountId)
      if (!finalAccount || !isAccountWriteEligible(finalAccount)) {
        throw new Error(`Account ${accountId} could not be read safely after update.`)
      }
      const balanceChanged = finalAccount.balance !== currentAccount.balance
      writeAuditLog({
        entity: 'account',
        entityId: accountId,
        action: 'update',
        before: accountUpdateAuditPayload(currentAccount, balanceChanged),
        after: accountUpdateAuditPayload(finalAccount, balanceChanged),
      })

      return {
        success: true,
        message: `Updated account "${finalAccount.name}".`,
        account: accountAuditSnapshot(finalAccount),
        reconciliation: prepared.reconciliationPlan,
      }
    })
  },
}

const setAccountAliasTool: ToolDefinition = {
  name: 'set-account-alias',
  description:
    'Assign a friendly alias to an existing account so future commands can use --account instead of a long account ID.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Canonical account ID to alias', 128),
    alias: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(
        validateAccountAlias,
        'Alias must use letters, numbers, dots, underscores, or hyphens'
      )
      .describe('Friendly alias, e.g. bbva-checking'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the alias without writing it'),
  }),
  execute: async ({ accountId, alias, dryRun }) => {
    const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [
      accountId,
    ])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    if (!isAccountWriteEligible(existing[0])) return archivedAccountResult(existing[0])

    if (dryRun) {
      const normalizedAlias = normalizeAccountAlias(alias)
      if (!validateAccountAlias(normalizedAlias)) {
        return {
          success: false,
          message:
            'Alias must start with a letter or number and use only lowercase letters, numbers, dots, underscores, or hyphens.',
        }
      }
      const existingAliasTarget = getAccountAliases()[normalizedAlias]
      if (existingAliasTarget && existingAliasTarget !== accountId) {
        return {
          success: false,
          reason: 'alias_conflict',
          message: `Alias "${normalizedAlias}" already points to account ${existingAliasTarget}. Remove or choose a different alias before reassigning it.`,
        }
      }

      return {
        success: true,
        dryRun: true,
        wouldSetAlias: {
          alias: normalizedAlias,
          accountId,
          account: {
            id: existing[0].id,
            name: existing[0].name,
            type: existing[0].type,
            currency: existing[0].currency,
          },
        },
        message: `Dry run: alias "${normalizedAlias}" would point to account "${existing[0].name}".`,
      }
    }

    const result = setAccountAlias(accountId, alias)
    if (!result.success) return result

    return {
      success: true,
      alias: result.alias,
      accountId,
      account: {
        id: existing[0].id,
        name: existing[0].name,
        type: existing[0].type,
        currency: existing[0].currency,
      },
      message: `Alias "${result.alias}" now points to account "${existing[0].name}".`,
    }
  },
}

const balanceSnapshot: ToolDefinition = {
  name: 'balance-snapshot',
  description:
    'Record an observed account balance as a snapshot without treating it as income or expense.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Canonical account ID', 128).optional(),
    account: boundedText(
      'Account alias',
      'Account alias, exact account ID, or exact account name',
      128
    )
      .optional()
      .describe('Friendly account alias, exact account ID, or exact account name'),
    balance: moneyAmount('Observed account balance in the main currency unit'),
    date: isoDate('Snapshot date in YYYY-MM-DD format. Defaults to today.').optional(),
    source: boundedText('Source', 'Optional source label for output metadata', 120).optional(),
    note: boundedText('Note', 'Optional note for output metadata', 500).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the balance snapshot without writing it'),
  }),
  execute: async ({ accountId, account, balance, date, source, note, dryRun }) => {
    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) {
      return { success: false, message: resolvedAccount.message }
    }

    const snapshotDate = date || dayjs().format('YYYY-MM-DD')
    assertObservationDate(snapshotDate, dayjs().format('YYYY-MM-DD'))
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldSnapshot: {
          accountId: resolvedAccount.id,
          date: snapshotDate,
          balance,
        },
        metadata: {
          source: source ?? null,
          note: note ?? null,
        },
        message: `Dry run: balance snapshot for ${resolvedAccount.id} on ${snapshotDate} would be recorded.`,
      }
    }

    const snapshot = upsertBalanceSnapshot(resolvedAccount.id, snapshotDate, toCentavos(balance))

    return {
      success: true,
      snapshot,
      metadata: {
        source: source ?? null,
        note: note ?? null,
      },
      message: `Recorded balance snapshot for ${resolvedAccount.id} on ${snapshotDate}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 9. delete-account
// ---------------------------------------------------------------------------
const deleteAccount: ToolDefinition = {
  name: 'delete-account',
  description:
    'Delete or archive an account. If the account has linked transactions it will be archived instead of deleted.',
  schema: z.object({
    accountId: z.string().describe('The ID of the account to delete'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the account deletion/archive without writing it'),
  }),
  execute: async ({ accountId, dryRun }) => {
    const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [accountId])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]
    if (!isAccountWriteEligible(account)) return archivedAccountResult(account)

    const getReferenceCounts = () => {
      const txCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM transactions WHERE account_id = $1 OR transfer_to_account_id = $2',
        [accountId, accountId]
      )
      const recurringRuleCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM recurring_rules WHERE account_id = $1 OR to_account_id = $2',
        [accountId, accountId]
      )
      const goalCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM goals WHERE account_id = $1',
        [accountId]
      )
      const balanceHistoryCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM account_balance_history WHERE account_id = $1',
        [accountId]
      )
      const statementCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM credit_card_statements WHERE account_id = $1',
        [accountId]
      )
      const investmentCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM investments WHERE account_id = $1',
        [accountId]
      )
      const subscriptionCount = query<{ count: number }>(
        'SELECT COUNT(*) as count FROM subscriptions WHERE account_id = $1',
        [accountId]
      )
      const aliasesForAccount = Object.entries(getAccountAliases())
        .filter(([, id]) => id === accountId)
        .map(([alias]) => alias)
        .sort()

      const counts = {
        linkedTransactionCount: txCount[0]?.count ?? 0,
        linkedRecurringRuleCount: recurringRuleCount[0]?.count ?? 0,
        linkedGoalCount: goalCount[0]?.count ?? 0,
        linkedBalanceHistoryCount: balanceHistoryCount[0]?.count ?? 0,
        linkedCreditCardStatementCount: statementCount[0]?.count ?? 0,
        linkedInvestmentCount: investmentCount[0]?.count ?? 0,
        linkedSubscriptionCount: subscriptionCount[0]?.count ?? 0,
        linkedCoverageCount: countAccountCurrencyBlockers(
          'SELECT COUNT(*) AS count FROM source_coverage WHERE account_id = ?',
          [accountId]
        ),
        linkedReconciliationCount: countAccountCurrencyBlockers(
          'SELECT COUNT(*) AS count FROM account_reconciliations WHERE account_id = ?',
          [accountId]
        ),
      }
      const linkedReferenceCount = Object.values(counts).reduce((sum, count) => sum + count, 0)

      return {
        ...counts,
        linkedAliasCount: aliasesForAccount.length,
        aliasesForAccount,
        linkedReferenceCount,
      }
    }

    const referenceCounts = getReferenceCounts()
    const {
      linkedTransactionCount,
      linkedRecurringRuleCount,
      linkedGoalCount,
      linkedBalanceHistoryCount,
      linkedCreditCardStatementCount,
      linkedInvestmentCount,
      linkedSubscriptionCount,
      linkedAliasCount,
      aliasesForAccount,
      linkedReferenceCount,
    } = referenceCounts
    const hasLinkedReferences = linkedReferenceCount > 0

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        action: hasLinkedReferences ? 'archived' : 'deleted',
        wouldDelete: hasLinkedReferences ? null : accountAuditSnapshot(account),
        wouldArchive: hasLinkedReferences
          ? {
              before: accountAuditSnapshot(account),
              after: accountAuditSnapshot({ ...account, is_archived: 1 }),
              linkedTransactionCount,
              linkedRecurringRuleCount,
              linkedGoalCount,
              linkedBalanceHistoryCount,
              linkedCreditCardStatementCount,
              linkedInvestmentCount,
              linkedSubscriptionCount,
              linkedAliasCount,
              aliasesRemoved: aliasesForAccount,
            }
          : null,
        aliasesRemoved: aliasesForAccount,
        message: hasLinkedReferences
          ? `Dry run: account "${account.name}" would be archived (has ${linkedReferenceCount} linked reference${linkedReferenceCount === 1 ? '' : 's'}).${aliasesForAccount.length > 0 ? ` ${aliasesForAccount.length} alias${aliasesForAccount.length === 1 ? '' : 'es'} would be removed.` : ''}`
          : `Dry run: account "${account.name}" would be deleted.${aliasesForAccount.length > 0 ? ` ${aliasesForAccount.length} alias${aliasesForAccount.length === 1 ? '' : 'es'} would be removed.` : ''}`,
      }
    }

    return transaction(() => {
      const appliedReferenceCounts = getReferenceCounts()
      const appliedLinkedReferenceCount = appliedReferenceCounts.linkedReferenceCount
      const aliasesRemoved = removeAccountAliasesForAccount(accountId)
      if (appliedLinkedReferenceCount > 0) {
        const archiveResult = execute(
          "UPDATE accounts SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1",
          [accountId]
        )
        assertSingleRowUpdated(archiveResult, `Account ${accountId} could not be archived safely.`)
        execute(
          "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE active = 1 AND (account_id = $1 OR to_account_id = $2)",
          [accountId, accountId]
        )
        execute(
          "UPDATE subscriptions SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE is_active = 1 AND account_id = $1",
          [accountId]
        )
        writeAuditLog({
          entity: 'account',
          entityId: accountId,
          action: 'archive',
          before: { account: accountAuditSnapshot(account) },
          after: { account: accountAuditSnapshot({ ...account, is_archived: 1 }) },
        })
        return {
          success: true,
          action: 'archived',
          aliasesRemoved,
          message: `Archived account "${account.name}" (has ${appliedLinkedReferenceCount} linked reference${appliedLinkedReferenceCount === 1 ? '' : 's'}).${aliasesRemoved.length > 0 ? ` Removed ${aliasesRemoved.length} alias${aliasesRemoved.length === 1 ? '' : 'es'}.` : ''}`,
        }
      }

      const deleteResult = execute('DELETE FROM accounts WHERE id = $1', [accountId])
      assertSingleRowUpdated(deleteResult, `Account ${accountId} could not be deleted safely.`)
      writeAuditLog({
        entity: 'account',
        entityId: accountId,
        action: 'delete',
        before: { account: accountAuditSnapshot(account) },
        after: null,
      })

      return {
        success: true,
        action: 'deleted',
        aliasesRemoved,
        message: `Deleted account "${account.name}".${aliasesRemoved.length > 0 ? ` Removed ${aliasesRemoved.length} alias${aliasesRemoved.length === 1 ? '' : 'es'}.` : ''}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 10. list-categories
// ---------------------------------------------------------------------------
const listCategories: ToolDefinition = {
  name: 'list-categories',
  description:
    'List available transaction categories. Use this when the user asks about categories or needs to pick one.',
  schema: z.object({
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('Filter by category type'),
  }),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM categories'

    if (type) {
      sql += ' WHERE type = $1'
      params.push(type)
    }

    sql += ' ORDER BY sort_order'

    const categories = await query<CategoryRow>(sql, params)

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        color: c.color,
      })),
      message:
        categories.length === 0
          ? 'No categories found.'
          : `Found ${categories.length} categor${categories.length !== 1 ? 'ies' : 'y'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 11. get-balance-overview
// ---------------------------------------------------------------------------

export const accountsTools: ToolDefinition[] = [
  listAccounts,
  createAccount,
  upsertAccount,
  updateAccount,
  setAccountAliasTool,
  balanceSnapshot,
  ...accountReconciliationTools,
  deleteAccount,
  listCategories,
]
