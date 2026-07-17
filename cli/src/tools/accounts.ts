import {
  calculateReconciliationAdjustment,
  signedLedgerDeltaForAccount,
  type LedgerEntry,
} from '@shikin/finance-core'
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

function accountCurrencyChangeBlockedMessage(referenceCount: number) {
  return `Cannot change this account currency while ${referenceCount} linked monetary reference${referenceCount === 1 ? '' : 's'} still point at the account. Create a new account or explicitly migrate the referenced data so amounts do not silently change meaning.`
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
  if (transactionCount === 0) return null
  return {
    success: false as const,
    reason: 'account_mode_transition_requires_new_account' as const,
    message: `Account "${account.name}" has ${transactionCount} ledger row${transactionCount === 1 ? '' : 's'}. Create a new ${nextMode} account so historical and observed balance bases are not mixed.`,
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
    (accountBalance === 0 ? 0 : 1)

  return blockingReferenceCount > 0
    ? accountCurrencyChangeBlockedMessage(blockingReferenceCount)
    : null
}

type AccountUpdateFields = {
  name?: string
  type?: AccountType
  currency?: string
  balance?: number
  creditLimit?: number
  statementClosingDay?: number
  paymentDueDay?: number
  accountMode?: AccountRow['account_mode']
}

function prepareAccountUpdate(
  account: AccountRow,
  input: AccountUpdateFields,
  onlyChangedValues: boolean
) {
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
      input.creditLimit !== undefined ? toCentavos(input.creditLimit) : account.credit_limit,
    statement_closing_day: input.statementClosingDay ?? account.statement_closing_day,
    payment_due_day: input.paymentDueDay ?? account.payment_due_day,
    account_mode: nextMode,
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
  if (
    shouldSet(
      input.creditLimit !== undefined,
      input.creditLimit !== undefined && toCentavos(input.creditLimit) !== account.credit_limit
    )
  ) {
    addSet('credit_limit', toCentavos(input.creditLimit!))
  }
  if (
    shouldSet(
      input.statementClosingDay !== undefined,
      input.statementClosingDay !== account.statement_closing_day
    )
  ) {
    addSet('statement_closing_day', input.statementClosingDay)
  }
  if (
    shouldSet(input.paymentDueDay !== undefined, input.paymentDueDay !== account.payment_due_day)
  ) {
    addSet('payment_due_day', input.paymentDueDay)
  }

  const needsBalanceReconciliation =
    nextMode === 'transactional' &&
    (currentMode === 'snapshot_only'
      ? requestedBalanceCentavos !== 0 || requestedBalanceCentavos !== account.balance
      : input.balance !== undefined && requestedBalanceCentavos !== account.balance)

  return {
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
    accountMode: accountModeSchema()
      .optional()
      .default('transactional')
      .describe(
        'transactional derives balance changes from the ledger; snapshot_only uses observed valuations'
      ),
    creditLimit: nonNegativeMoneyAmount(
      'Credit limit in the main currency unit (only for credit_card type)'
    ).optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
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
    dryRun,
  }) => {
    const id = generateId()
    const balanceCentavos = toCentavos(balance)
    const creditLimitCentavos = creditLimit !== undefined ? toCentavos(creditLimit) : null
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
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day, account_mode)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
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
        ]
      )
      if (accountMode === 'transactional' && balanceCentavos !== 0) {
        reconcileTransactionalAccountBalance({
          accountId: id,
          currency,
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
    if (creditLimit !== undefined) parts.push(`credit limit: $${creditLimit.toFixed(2)}`)
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
    accountMode: accountModeSchema().optional().describe('Account balance tracking mode'),
    creditLimit: nonNegativeMoneyAmount(
      'Credit limit in the main currency unit (only for credit_card type)'
    ).optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
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
    dryRun,
  }) => {
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
          credit_limit: creditLimit !== undefined ? toCentavos(creditLimit) : null,
          statement_closing_day: statementClosingDay ?? null,
          payment_due_day: paymentDueDay ?? null,
          account_mode: accountMode ?? 'transactional',
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
        const creditLimitCentavos = creditLimit !== undefined ? toCentavos(creditLimit) : null
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
        }

        execute(
          `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day, account_mode)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
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
          ]
        )
        if (createdAccount.account_mode === 'transactional' && balanceCentavos !== 0) {
          reconcileTransactionalAccountBalance({
            accountId: id,
            currency: createdCurrency,
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
    accountMode: accountModeSchema().optional().describe('New account balance tracking mode'),
    creditLimit: nonNegativeMoneyAmount('New credit limit in main currency unit').optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('New statement closing day (1-31)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
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

type LedgerCandidateRow = {
  id: string
  type: string
  amount: number
  currency: string | null
  status: string | null
  ledger_treatment: string | null
  transaction_kind: string | null
  is_archived: number | null
  account_id: string
  source_account_id: string | null
  source_currency: string | null
  source_account_mode: string | null
  transfer_to_account_id: string | null
  destination_account_id: string | null
  destination_currency: string | null
  destination_account_mode: string | null
}

function getEffectiveLedgerBalance(accountId: string): number {
  const rows = query<LedgerCandidateRow>(
    `SELECT t.id, t.type, t.amount, t.currency, t.status, t.ledger_treatment, t.transaction_kind,
            t.is_archived, t.account_id,
            source.id AS source_account_id, source.currency AS source_currency,
            source.account_mode AS source_account_mode,
            t.transfer_to_account_id,
            destination.id AS destination_account_id,
            destination.currency AS destination_currency,
            destination.account_mode AS destination_account_mode
       FROM transactions t
       LEFT JOIN accounts source ON source.id = t.account_id
       LEFT JOIN accounts destination ON destination.id = t.transfer_to_account_id
      WHERE t.account_id = $1 OR t.transfer_to_account_id = $2
      ORDER BY t.id`,
    [accountId, accountId]
  )

  return rows.reduce((balance, row) => {
    if (!row.source_account_id || row.source_currency === null) {
      throw new Error(`Transaction ${row.id} has no valid source account context.`)
    }
    const entry: LedgerEntry = {
      type: row.type as LedgerEntry['type'],
      amountCentavos: row.amount,
      currency: row.currency as LedgerEntry['currency'],
      account: {
        accountId: row.source_account_id,
        currency: row.source_currency,
        accountMode: row.source_account_mode as LedgerEntry['account']['accountMode'],
      },
      transferToAccount:
        row.destination_account_id && row.destination_currency !== null
          ? {
              accountId: row.destination_account_id,
              currency: row.destination_currency,
              accountMode: row.destination_account_mode as LedgerEntry['account']['accountMode'],
            }
          : null,
      status: row.status,
      ledgerTreatment: row.ledger_treatment as LedgerEntry['ledgerTreatment'],
      transactionKind: row.transaction_kind as LedgerEntry['transactionKind'],
      isArchived: row.is_archived as LedgerEntry['isArchived'],
    }
    const result = signedLedgerDeltaForAccount(entry, accountId)
    if (result.status !== 'applied') return balance
    const next = balance + result.deltaCentavos
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`Effective ledger balance for account ${accountId} is outside range.`)
    }
    return next
  }, 0)
}

function insertReconciliationRecord(input: {
  id: string
  accountId: string
  date: string
  actualBalance: number
  storedBalanceBefore: number
  ledgerBalanceBefore: number
  ledgerBalanceAfter: number
  adjustmentAmount: number
  adjustmentTransactionId?: string | null
  stagingBatchId?: string | null
  statementStartDate?: string | null
  statementEndDate?: string | null
  source?: string | null
  note?: string | null
}) {
  execute(
    `INSERT INTO account_reconciliations (
       id, account_id, reconciliation_date, actual_balance, stored_balance_before,
       ledger_balance_before, ledger_balance_after, adjustment_amount,
       adjustment_transaction_id, staging_batch_id, statement_start_date,
       statement_end_date, source, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      input.id,
      input.accountId,
      input.date,
      input.actualBalance,
      input.storedBalanceBefore,
      input.ledgerBalanceBefore,
      input.ledgerBalanceAfter,
      input.adjustmentAmount,
      input.adjustmentTransactionId ?? null,
      input.stagingBatchId ?? null,
      input.statementStartDate ?? null,
      input.statementEndDate ?? null,
      input.source ?? null,
      input.note ?? null,
    ]
  )
}

function reconcileTransactionalAccountBalance(input: {
  accountId: string
  currency: string
  observedBalance: number
  storedBalanceBefore: number
  date?: string
}) {
  const ledgerBalanceBefore = getEffectiveLedgerBalance(input.accountId)
  const adjustment = calculateReconciliationAdjustment({
    accountMode: 'transactional',
    observedBalanceCentavos: input.observedBalance,
    effectiveLedgerBalanceCentavos: ledgerBalanceBefore,
  })
  if (adjustment.status !== 'ledger_adjustment') {
    throw new Error('Transactional reconciliation policy returned an observed-only adjustment.')
  }

  const reconciliationId = generateId()
  const reconciliationDate = input.date ?? dayjs().format('YYYY-MM-DD')
  insertReconciliationRecord({
    id: reconciliationId,
    accountId: input.accountId,
    date: reconciliationDate,
    actualBalance: input.observedBalance,
    storedBalanceBefore: input.storedBalanceBefore,
    ledgerBalanceBefore,
    ledgerBalanceAfter: input.observedBalance,
    adjustmentAmount: adjustment.adjustmentCentavos,
  })

  let adjustmentTransactionId: string | null = null
  if (adjustment.bridge) {
    adjustmentTransactionId = generateId()
    execute(
      `INSERT INTO transactions (
         id, account_id, category_id, transfer_to_account_id, type, amount, currency,
         description, notes, status, source, note, ledger_treatment, reporting_treatment,
         transaction_kind, reconciliation_id, is_archived, date
       ) VALUES ($1, $2, NULL, NULL, $3, $4, $5, 'Balance reconciliation bridge', NULL,
         'posted', NULL, NULL, 'normal', $6, $7, $8, 0, $9)`,
      [
        adjustmentTransactionId,
        input.accountId,
        adjustment.bridge.type,
        adjustment.bridge.amountCentavos,
        input.currency,
        adjustment.bridge.reportingTreatment,
        adjustment.bridge.transactionKind,
        reconciliationId,
        reconciliationDate,
      ]
    )
    assertSingleRowUpdated(
      execute('UPDATE account_reconciliations SET adjustment_transaction_id = $1 WHERE id = $2', [
        adjustmentTransactionId,
        reconciliationId,
      ]),
      `Reconciliation ${reconciliationId} could not be linked to its bridge.`
    )
  }

  assertSingleRowUpdated(
    execute(
      "UPDATE accounts SET balance = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND is_archived = 0",
      [input.observedBalance, input.accountId]
    ),
    `Account ${input.accountId} could not be reconciled safely.`
  )
  const verifiedLedgerBalance = getEffectiveLedgerBalance(input.accountId)
  if (verifiedLedgerBalance !== input.observedBalance) {
    throw new Error(
      `Reconciliation verification failed: ledger ${verifiedLedgerBalance} did not match observed balance ${input.observedBalance}.`
    )
  }

  return {
    reconciliationId,
    adjustmentTransactionId,
    adjustmentCentavos: adjustment.adjustmentCentavos,
    verifiedLedgerBalance,
  }
}

const reconcile: ToolDefinition = {
  name: 'reconcile',
  description:
    'Compare an observed balance against the effective transaction ledger and optionally apply an atomic reconciliation bridge.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Canonical account ID', 128).optional(),
    account: boundedText(
      'Account alias',
      'Account alias, exact account ID, or exact account name',
      128
    )
      .optional()
      .describe('Friendly account alias, exact account ID, or exact account name'),
    actualBalance: moneyAmount('Observed actual balance in the main currency unit'),
    date: isoDate('Reconciliation date in YYYY-MM-DD format. Defaults to today.').optional(),
    statementStartDate: isoDate('Optional statement coverage start date').optional(),
    statementEndDate: isoDate('Optional statement coverage end date').optional(),
    basis: z
      .literal('effective_ledger')
      .optional()
      .describe('Required for apply: acknowledges ledger-derived reconciliation semantics'),
    apply: z
      .boolean()
      .optional()
      .default(false)
      .describe('Apply the adjustment transaction and balance snapshot'),
    source: boundedText(
      'Source',
      'Optional source label stored in the adjustment notes',
      120
    ).optional(),
    note: boundedText('Note', 'Optional note stored in the adjustment notes', 500).optional(),
  }),
  execute: async ({
    accountId,
    account,
    actualBalance,
    date,
    statementStartDate,
    statementEndDate,
    basis,
    apply,
    source,
    note,
  }) => {
    if (statementStartDate && statementEndDate && statementStartDate > statementEndDate) {
      return {
        success: false,
        reason: 'invalid_statement_range',
        message: 'statementStartDate must be on or before statementEndDate.',
      }
    }
    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) {
      return { success: false, message: resolvedAccount.message }
    }

    const rows = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [
      resolvedAccount.id,
    ])
    if (rows.length === 0) {
      return { success: false, message: `Account ${resolvedAccount.id} not found.` }
    }

    const accountRow = rows[0]
    if (!isAccountWriteEligible(accountRow)) return archivedAccountResult(accountRow)
    const actualCentavos = toCentavos(actualBalance)
    const ledgerBalanceCentavos = getEffectiveLedgerBalance(accountRow.id)
    const ledgerDifferenceCentavos = actualCentavos - ledgerBalanceCentavos
    const storedDifferenceCentavos = actualCentavos - accountRow.balance
    const snapshotOnly = (accountRow.account_mode ?? 'transactional') === 'snapshot_only'
    const differenceCentavos = snapshotOnly ? storedDifferenceCentavos : ledgerDifferenceCentavos
    const reconciliationDate = date || dayjs().format('YYYY-MM-DD')
    const baseResult = {
      account: {
        id: accountRow.id,
        name: accountRow.name,
        currency: accountRow.currency,
        accountMode: accountRow.account_mode ?? 'transactional',
      },
      storedBalance: fromCentavos(accountRow.balance),
      storedBalanceCentavos: accountRow.balance,
      ledgerBalance: fromCentavos(ledgerBalanceCentavos),
      ledgerBalanceCentavos,
      actualBalance: fromCentavos(actualCentavos),
      actualBalanceCentavos: actualCentavos,
      difference: fromCentavos(differenceCentavos),
      differenceCentavos,
      ledgerDifference: fromCentavos(ledgerDifferenceCentavos),
      ledgerDifferenceCentavos,
      storedDifference: fromCentavos(storedDifferenceCentavos),
      storedDifferenceCentavos,
      date: reconciliationDate,
      statementCoverage: {
        startDate: statementStartDate ?? null,
        endDate: statementEndDate ?? null,
      },
    }

    if (!apply) {
      return {
        success: true,
        dryRun: true,
        applied: false,
        applyRequired: differenceCentavos !== 0,
        requiredBasis: 'effective_ledger',
        ...baseResult,
        requiresConfirmation: differenceCentavos !== 0,
        message:
          differenceCentavos === 0
            ? `Account "${accountRow.name}" effective ledger already matches ${accountRow.currency} ${actualBalance.toFixed(2)}.`
            : `Account "${accountRow.name}" needs a ${accountRow.currency} ${fromCentavos(differenceCentavos).toFixed(2)} reconciliation change based on its effective ledger. Re-run with --apply.`,
      }
    }

    if (basis !== 'effective_ledger') {
      return {
        success: false,
        reason: 'reconciliation_basis_required',
        requiredBasis: 'effective_ledger',
        message:
          'Applying reconciliation requires basis="effective_ledger" after reviewing the ledger-derived preview.',
      }
    }

    const result = transaction(() => {
      const accountRow = getAccountById(resolvedAccount.id)
      if (!accountRow) {
        throw new Error(`Account ${resolvedAccount.id} disappeared during reconciliation.`)
      }
      if (!isAccountWriteEligible(accountRow)) {
        throw new Error(archivedAccountResult(accountRow).message)
      }
      const ledgerBalanceCentavos = getEffectiveLedgerBalance(accountRow.id)
      const ledgerDifferenceCentavos = actualCentavos - ledgerBalanceCentavos
      const storedDifferenceCentavos = actualCentavos - accountRow.balance
      const snapshotOnly = (accountRow.account_mode ?? 'transactional') === 'snapshot_only'
      const differenceCentavos = snapshotOnly ? storedDifferenceCentavos : ledgerDifferenceCentavos
      const baseResult = {
        account: {
          id: accountRow.id,
          name: accountRow.name,
          currency: accountRow.currency,
          accountMode: accountRow.account_mode ?? 'transactional',
        },
        storedBalance: fromCentavos(accountRow.balance),
        storedBalanceCentavos: accountRow.balance,
        ledgerBalance: fromCentavos(ledgerBalanceCentavos),
        ledgerBalanceCentavos,
        actualBalance: fromCentavos(actualCentavos),
        actualBalanceCentavos: actualCentavos,
        difference: fromCentavos(differenceCentavos),
        differenceCentavos,
        ledgerDifference: fromCentavos(ledgerDifferenceCentavos),
        ledgerDifferenceCentavos,
        storedDifference: fromCentavos(storedDifferenceCentavos),
        storedDifferenceCentavos,
        date: reconciliationDate,
        statementCoverage: {
          startDate: statementStartDate ?? null,
          endDate: statementEndDate ?? null,
        },
      }
      const snapshot = upsertBalanceSnapshot(accountRow.id, reconciliationDate, actualCentavos)
      const reconciliationId = generateId()

      if (differenceCentavos === 0 || snapshotOnly) {
        insertReconciliationRecord({
          id: reconciliationId,
          accountId: accountRow.id,
          date: reconciliationDate,
          actualBalance: actualCentavos,
          storedBalanceBefore: accountRow.balance,
          ledgerBalanceBefore: ledgerBalanceCentavos,
          ledgerBalanceAfter: ledgerBalanceCentavos,
          adjustmentAmount: 0,
          statementStartDate,
          statementEndDate,
          source,
          note,
        })
        assertSingleRowUpdated(
          execute(
            "UPDATE accounts SET balance = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND is_archived = 0",
            [actualCentavos, accountRow.id]
          ),
          `Account ${accountRow.id} could not be reconciled safely.`
        )
        const verifiedLedgerCentavos = getEffectiveLedgerBalance(accountRow.id)
        if (!snapshotOnly && verifiedLedgerCentavos !== actualCentavos) {
          throw new Error(
            `Reconciliation verification failed: ledger ${verifiedLedgerCentavos} did not match observed balance ${actualCentavos}.`
          )
        }
        writeAuditLog({
          entity: 'account',
          entityId: accountRow.id,
          action: 'reconcile',
          before: {
            account: accountAuditSnapshot(accountRow),
            ledgerBalanceCentavos,
          },
          after: {
            account: accountAuditSnapshot({ ...accountRow, balance: actualCentavos }),
            reconciliationId,
            adjustmentTransactionId: null,
            verifiedLedgerCentavos,
          },
          source: source ?? null,
          note: note ?? null,
        })
        return {
          success: true,
          dryRun: false,
          ...baseResult,
          reconciliationId,
          snapshot,
          adjustmentTransaction: null,
          verifiedLedgerBalance: fromCentavos(verifiedLedgerCentavos),
          verifiedLedgerBalanceCentavos: verifiedLedgerCentavos,
          message: snapshotOnly
            ? `Recorded observed valuation for snapshot-only account "${accountRow.name}" without creating cashflow.`
            : `Recorded reconciliation for "${accountRow.name}"; its effective ledger already matched.`,
        }
      }

      const adjustmentId = generateId()
      const adjustmentType = differenceCentavos > 0 ? 'income' : 'expense'
      const adjustmentAmount = Math.abs(differenceCentavos)

      insertReconciliationRecord({
        id: reconciliationId,
        accountId: accountRow.id,
        date: reconciliationDate,
        actualBalance: actualCentavos,
        storedBalanceBefore: accountRow.balance,
        ledgerBalanceBefore: ledgerBalanceCentavos,
        ledgerBalanceAfter: actualCentavos,
        adjustmentAmount: differenceCentavos,
        statementStartDate,
        statementEndDate,
        source,
        note,
      })

      execute(
        `INSERT INTO transactions (
           id, account_id, category_id, transfer_to_account_id, type, amount, currency,
           description, notes, status, source, note, ledger_treatment, reporting_treatment,
           transaction_kind, reconciliation_id, is_archived, date
         ) VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, NULL, 'posted', $7, $8,
           'normal', 'exclude_from_cashflow', 'reconciliation_bridge', $9, 0, $10)`,
        [
          adjustmentId,
          accountRow.id,
          adjustmentType,
          adjustmentAmount,
          accountRow.currency,
          'Balance reconciliation bridge',
          source ?? null,
          note ?? null,
          reconciliationId,
          reconciliationDate,
        ]
      )
      assertSingleRowUpdated(
        execute('UPDATE account_reconciliations SET adjustment_transaction_id = $1 WHERE id = $2', [
          adjustmentId,
          reconciliationId,
        ]),
        `Reconciliation ${reconciliationId} could not be linked to its bridge.`
      )
      assertSingleRowUpdated(
        execute(
          "UPDATE accounts SET balance = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND is_archived = 0",
          [actualCentavos, accountRow.id]
        ),
        `Account ${accountRow.id} could not be reconciled safely.`
      )
      const verifiedLedgerCentavos = getEffectiveLedgerBalance(accountRow.id)
      if (verifiedLedgerCentavos !== actualCentavos) {
        throw new Error(
          `Reconciliation verification failed: ledger ${verifiedLedgerCentavos} did not match observed balance ${actualCentavos}.`
        )
      }
      writeAuditLog({
        entity: 'account',
        entityId: accountRow.id,
        action: 'reconcile',
        before: {
          account: accountAuditSnapshot(accountRow),
          balance: {
            balanceCentavos: accountRow.balance,
            balance: fromCentavos(accountRow.balance),
          },
        },
        after: {
          account: accountAuditSnapshot({ ...accountRow, balance: actualCentavos }),
          balance: {
            balanceCentavos: actualCentavos,
            balance: fromCentavos(actualCentavos),
          },
          adjustmentTransactionId: adjustmentId,
          reconciliationId,
          verifiedLedgerCentavos,
        },
        source: source ?? null,
        note: note ?? null,
      })

      return {
        success: true,
        dryRun: false,
        ...baseResult,
        reconciliationId,
        snapshot,
        adjustmentTransaction: {
          id: adjustmentId,
          type: adjustmentType,
          amount: fromCentavos(adjustmentAmount),
          currency: accountRow.currency,
          description: 'Balance reconciliation bridge',
          notes: null,
          status: 'posted',
          source: source ?? null,
          note: note ?? null,
          date: reconciliationDate,
          reportingTreatment: 'exclude_from_cashflow',
          transactionKind: 'reconciliation_bridge',
          reconciliationId,
        },
        verifiedLedgerBalance: fromCentavos(verifiedLedgerCentavos),
        verifiedLedgerBalanceCentavos: verifiedLedgerCentavos,
        message: `Reconciled "${accountRow.name}" to ${accountRow.currency} ${actualBalance.toFixed(2)} from its effective ledger.`,
      }
    })

    return result
  },
}

type StagedHistoryRow = {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  date: string
}

function getStagedHistoryRows(accountId: string, stagingBatchId: string): StagedHistoryRow[] {
  return query<StagedHistoryRow>(
    `SELECT id, type, amount, date
     FROM transactions
     WHERE account_id = $1
       AND staging_batch_id = $2
       AND COALESCE(ledger_treatment, 'normal') = 'staged_no_balance_impact'
       AND COALESCE(is_archived, 0) = 0
     ORDER BY date ASC, id ASC`,
    [accountId, stagingBatchId]
  )
}

function stagedCoverageFailure(
  rows: StagedHistoryRow[],
  statementStartDate: string,
  statementEndDate: string
) {
  if (rows.length === 0) {
    return {
      success: false as const,
      reason: 'staged_batch_not_found' as const,
      message: 'No staged rows were found for this account and batch.',
    }
  }
  if (rows.some((row) => row.type === 'transfer')) {
    return {
      success: false as const,
      reason: 'staged_transfer_requires_matching' as const,
      message: 'Staged statement rows must remain account-side income or expense entries.',
    }
  }
  const observedStartDate = rows[0].date
  const observedEndDate = rows[rows.length - 1].date
  if (observedStartDate < statementStartDate || observedEndDate > statementEndDate) {
    return {
      success: false as const,
      reason: 'statement_coverage_mismatch' as const,
      message: `Batch dates ${observedStartDate} through ${observedEndDate} fall outside declared coverage ${statementStartDate} through ${statementEndDate}.`,
    }
  }
  return null
}

function stagedBatchImpact(rows: StagedHistoryRow[]): number {
  return rows.reduce((sum, row) => sum + (row.type === 'income' ? row.amount : -row.amount), 0)
}

const finalizeStagedStatementHistory: ToolDefinition = {
  name: 'finalize-staged-statement-history',
  description:
    'Validate and atomically finalize staged statement history, create its reconciliation bridge, set the observed balance, and verify the ledger.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Canonical account ID', 128).optional(),
    account: boundedText('Account alias', 'Account alias, exact ID, or exact name', 128).optional(),
    stagingBatchId: boundedText('Staging batch ID', 'Batch identifier assigned during import', 128),
    statementStartDate: isoDate('Declared statement coverage start date'),
    statementEndDate: isoDate('Declared statement coverage end date'),
    actualBalance: moneyAmount('Observed balance at the statement end'),
    reconciliationDate: isoDate('Reconciliation date; defaults to statementEndDate').optional(),
    apply: z.boolean().optional().default(false).describe('Apply the atomic finalization'),
    source: boundedText('Source', 'Optional audit source', 120).optional(),
    note: boundedText('Note', 'Optional audit note', 500).optional(),
  }),
  execute: async ({
    accountId,
    account,
    stagingBatchId,
    statementStartDate,
    statementEndDate,
    actualBalance,
    reconciliationDate,
    apply,
    source,
    note,
  }) => {
    if (statementStartDate > statementEndDate) {
      return {
        success: false,
        reason: 'invalid_statement_range',
        message: 'statementStartDate must be on or before statementEndDate.',
      }
    }
    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) return { success: false, message: resolvedAccount.message }
    const accountRow = getAccountById(resolvedAccount.id)
    if (!accountRow) return { success: false, message: `Account ${resolvedAccount.id} not found.` }
    if (!isAccountWriteEligible(accountRow)) return archivedAccountResult(accountRow)
    if ((accountRow.account_mode ?? 'transactional') !== 'transactional') {
      return {
        success: false,
        reason: 'snapshot_only_account',
        message:
          'Snapshot-only accounts use observed valuations rather than staged ledger finalization.',
      }
    }

    const rows = getStagedHistoryRows(accountRow.id, stagingBatchId)
    const coverageFailure = stagedCoverageFailure(rows, statementStartDate, statementEndDate)
    if (coverageFailure) return coverageFailure
    const actualCentavos = toCentavos(actualBalance)
    const ledgerBefore = getEffectiveLedgerBalance(accountRow.id)
    const batchImpact = stagedBatchImpact(rows)
    const ledgerAfterBatch = ledgerBefore + batchImpact
    const bridgeDifference = actualCentavos - ledgerAfterBatch
    const date = reconciliationDate ?? statementEndDate
    const preview = {
      account: { id: accountRow.id, name: accountRow.name, currency: accountRow.currency },
      stagingBatchId,
      statementCoverage: {
        startDate: statementStartDate,
        endDate: statementEndDate,
        observedStartDate: rows[0].date,
        observedEndDate: rows[rows.length - 1].date,
      },
      transactionCount: rows.length,
      transactionIds: rows.map((row) => row.id),
      ledgerBalanceBefore: fromCentavos(ledgerBefore),
      ledgerBalanceBeforeCentavos: ledgerBefore,
      stagedBalanceEffect: fromCentavos(batchImpact),
      stagedBalanceEffectCentavos: batchImpact,
      ledgerBalanceAfterBatch: fromCentavos(ledgerAfterBatch),
      ledgerBalanceAfterBatchCentavos: ledgerAfterBatch,
      reconciliationBridge: fromCentavos(bridgeDifference),
      reconciliationBridgeCentavos: bridgeDifference,
      actualBalance: fromCentavos(actualCentavos),
      actualBalanceCentavos: actualCentavos,
      reconciliationDate: date,
    }
    if (!apply) {
      return {
        success: true,
        dryRun: true,
        applyRequired: true,
        ...preview,
        message: `Dry run: ${rows.length} staged transaction(s) would be finalized with a ${accountRow.currency} ${fromCentavos(bridgeDifference).toFixed(2)} bridge.`,
      }
    }

    return transaction(() => {
      const currentAccount = getAccountById(accountRow.id)
      if (!currentAccount)
        throw new Error(`Account ${accountRow.id} disappeared during finalization.`)
      if (!isAccountWriteEligible(currentAccount)) {
        throw new Error(archivedAccountResult(currentAccount).message)
      }
      if ((currentAccount.account_mode ?? 'transactional') !== 'transactional') {
        throw new Error('Account mode changed after preview. Preview the staged batch again.')
      }
      const currentRows = getStagedHistoryRows(accountRow.id, stagingBatchId)
      const currentCoverageFailure = stagedCoverageFailure(
        currentRows,
        statementStartDate,
        statementEndDate
      )
      if (currentCoverageFailure) throw new Error(currentCoverageFailure.message)
      if (
        currentRows.length !== rows.length ||
        currentRows.some((row, index) => row.id !== rows[index]?.id)
      ) {
        throw new Error('Staged batch changed after preview. Preview it again before applying.')
      }
      const currentLedgerBefore = getEffectiveLedgerBalance(accountRow.id)
      const currentBatchImpact = stagedBatchImpact(currentRows)
      const currentBridgeDifference = actualCentavos - (currentLedgerBefore + currentBatchImpact)
      const reconciliationId = generateId()
      const adjustmentId = currentBridgeDifference === 0 ? null : generateId()
      insertReconciliationRecord({
        id: reconciliationId,
        accountId: accountRow.id,
        date,
        actualBalance: actualCentavos,
        storedBalanceBefore: currentAccount.balance,
        ledgerBalanceBefore: currentLedgerBefore,
        ledgerBalanceAfter: actualCentavos,
        adjustmentAmount: currentBridgeDifference,
        stagingBatchId,
        statementStartDate,
        statementEndDate,
        source,
        note,
      })
      const finalized = execute(
        `UPDATE transactions
         SET ledger_treatment = 'normal', status = 'cleared',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE account_id = $1 AND staging_batch_id = $2
           AND COALESCE(ledger_treatment, 'normal') = 'staged_no_balance_impact'
           AND COALESCE(is_archived, 0) = 0`,
        [accountRow.id, stagingBatchId]
      )
      if (finalized.rowsAffected !== currentRows.length) {
        throw new Error(
          `Expected to finalize ${currentRows.length} rows but updated ${finalized.rowsAffected}.`
        )
      }
      let adjustmentTransaction = null
      if (adjustmentId) {
        const adjustmentType = currentBridgeDifference > 0 ? 'income' : 'expense'
        const adjustmentAmount = Math.abs(currentBridgeDifference)
        execute(
          `INSERT INTO transactions (
             id, account_id, category_id, transfer_to_account_id, type, amount, currency,
             description, notes, status, source, note, ledger_treatment, reporting_treatment,
             transaction_kind, reconciliation_id, is_archived, date
           ) VALUES ($1, $2, NULL, NULL, $3, $4, $5, 'Balance reconciliation bridge', NULL,
             'posted', $6, $7, 'normal', 'exclude_from_cashflow', 'reconciliation_bridge', $8, 0, $9)`,
          [
            adjustmentId,
            accountRow.id,
            adjustmentType,
            adjustmentAmount,
            accountRow.currency,
            source ?? null,
            note ?? null,
            reconciliationId,
            date,
          ]
        )
        assertSingleRowUpdated(
          execute(
            'UPDATE account_reconciliations SET adjustment_transaction_id = $1 WHERE id = $2',
            [adjustmentId, reconciliationId]
          ),
          `Reconciliation ${reconciliationId} could not be linked to its bridge.`
        )
        adjustmentTransaction = {
          id: adjustmentId,
          type: adjustmentType,
          amount: fromCentavos(adjustmentAmount),
          amountCentavos: adjustmentAmount,
          reportingTreatment: 'exclude_from_cashflow',
          transactionKind: 'reconciliation_bridge',
          reconciliationId,
        }
      }
      assertSingleRowUpdated(
        execute(
          "UPDATE accounts SET balance = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND is_archived = 0",
          [actualCentavos, accountRow.id]
        ),
        `Account ${accountRow.id} could not be updated after finalization.`
      )
      const snapshot = upsertBalanceSnapshot(accountRow.id, date, actualCentavos)
      const verifiedLedgerCentavos = getEffectiveLedgerBalance(accountRow.id)
      if (verifiedLedgerCentavos !== actualCentavos) {
        throw new Error(
          `Finalization verification failed: ledger ${verifiedLedgerCentavos} did not match observed balance ${actualCentavos}.`
        )
      }
      writeAuditLog({
        entity: 'account',
        entityId: accountRow.id,
        action: 'finalize-staged-statement-history',
        before: {
          account: accountAuditSnapshot(currentAccount),
          stagingBatchId,
          transactionIds: currentRows.map((row) => row.id),
          ledgerBalanceCentavos: currentLedgerBefore,
        },
        after: {
          reconciliationId,
          adjustmentTransactionId: adjustmentId,
          balanceCentavos: actualCentavos,
          verifiedLedgerCentavos,
        },
        source: source ?? null,
        note: note ?? null,
      })
      return {
        success: true,
        dryRun: false,
        ...preview,
        reconciliationId,
        adjustmentTransaction,
        snapshot,
        verifiedLedgerBalance: fromCentavos(verifiedLedgerCentavos),
        verifiedLedgerBalanceCentavos: verifiedLedgerCentavos,
        message: `Finalized ${currentRows.length} staged transaction(s) and reconciled "${accountRow.name}" atomically.`,
      }
    })
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
  reconcile,
  finalizeStagedStatementHistory,
  deleteAccount,
  listCategories,
]
