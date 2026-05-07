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

function getAccountById(accountId: string): AccountRow | null {
  return query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [accountId])[0] ?? null
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

function countAccountCurrencyBlockers(sql: string, params: unknown[]): number {
  const rows = query<{ count: number }>(sql, params) as Array<{ count: number }> | undefined
  return rows?.[0]?.count ?? 0
}

function findExactNameAccount(name: string): AccountUpsertMatch {
  const matches = query<AccountRow>(
    'SELECT * FROM accounts WHERE LOWER(name) = LOWER($1) ORDER BY is_archived ASC, name ASC, id ASC LIMIT 3',
    [name]
  )
  const activeMatches = matches.filter((row) => row.is_archived !== 1)

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
      if (account.is_archived === 1) return archivedAccountResult(account)
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
      if (account.is_archived === 1) return archivedAccountResult(account)
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
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
        [
          id,
          name,
          type,
          currency,
          balanceCentavos,
          creditLimitCentavos,
          statementClosingDay ?? null,
          paymentDueDay ?? null,
        ]
      )
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
    dryRun,
  }) => {
    const match = resolveAccountForUpsert({ accountId, account, alias, name })
    if (!match.success) return match

    const normalizedAlias = alias ? normalizeAccountAlias(alias) : null
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
      }

      if (dryRun) {
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

      transaction(() => {
        execute(
          `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
          [
            id,
            createdAccount.name,
            createdType,
            createdCurrency,
            balanceCentavos,
            creditLimitCentavos,
            statementClosingDay ?? null,
            paymentDueDay ?? null,
          ]
        )
        if (normalizedAlias) setAccountAlias(id, normalizedAlias)
        writeAuditLog({
          entity: 'account',
          entityId: id,
          action: 'create',
          before: null,
          after: {
            account: accountAuditSnapshot(createdAccount),
            balanceChange: {
              previousBalanceCentavos: null,
              newBalanceCentavos: balanceCentavos,
              previousBalance: null,
              newBalance: fromCentavos(balanceCentavos),
            },
          },
        })
      })

      return {
        success: true,
        action: 'created' as const,
        matchedBy: match.matchedBy,
        account: accountAuditSnapshot(createdAccount),
        alias: normalizedAlias,
        message: `Created account "${createdAccount.name}".`,
      }
    }

    const existing = match.account
    const currencyFailure = accountCurrencyChangeFailure(existing.id, existing.currency, currency)
    if (currencyFailure) {
      return { success: false, message: currencyFailure }
    }

    const updatedAccount: AccountRow = {
      ...existing,
      name: name ?? existing.name,
      type: type ?? existing.type,
      currency: currency ?? existing.currency,
      balance: balance !== undefined ? toCentavos(balance) : existing.balance,
      credit_limit: creditLimit !== undefined ? toCentavos(creditLimit) : existing.credit_limit,
      statement_closing_day: statementClosingDay ?? existing.statement_closing_day,
      payment_due_day: paymentDueDay ?? existing.payment_due_day,
    }
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`)
      params.push(value)
    }

    if (name !== undefined && name !== existing.name) addSet('name', name)
    if (type !== undefined && type !== existing.type) addSet('type', type)
    if (
      currency !== undefined &&
      normalizeCurrencyCode(currency) !== normalizeCurrencyCode(existing.currency)
    ) {
      addSet('currency', currency)
    }
    if (balance !== undefined && toCentavos(balance) !== existing.balance) {
      addSet('balance', toCentavos(balance))
    }
    if (creditLimit !== undefined && toCentavos(creditLimit) !== existing.credit_limit) {
      addSet('credit_limit', toCentavos(creditLimit))
    }
    if (
      statementClosingDay !== undefined &&
      statementClosingDay !== existing.statement_closing_day
    ) {
      addSet('statement_closing_day', statementClosingDay)
    }
    if (paymentDueDay !== undefined && paymentDueDay !== existing.payment_due_day) {
      addSet('payment_due_day', paymentDueDay)
    }

    const aliasWouldChange = Boolean(normalizedAlias && existingAliasTarget !== existing.id)

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        matchedBy: match.matchedBy,
        changed: setClauses.length > 0 || aliasWouldChange,
        wouldUpdate: {
          accountId: existing.id,
          before: accountAuditSnapshot(existing),
          after: accountAuditSnapshot(updatedAccount),
        },
        wouldSetAlias: normalizedAlias
          ? { alias: normalizedAlias, accountId: existing.id, changed: aliasWouldChange }
          : null,
        message: `Dry run: account "${updatedAccount.name}" would be updated.`,
      }
    }

    if (setClauses.length > 0 || aliasWouldChange) {
      transaction(() => {
        if (setClauses.length > 0) {
          setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          params.push(existing.id)
          const updateResult = execute(
            `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
          )
          assertSingleRowUpdated(
            updateResult,
            `Account ${existing.id} could not be updated safely.`
          )
        }
        if (normalizedAlias) setAccountAlias(existing.id, normalizedAlias)
        const balanceChanged = updatedAccount.balance !== existing.balance
        writeAuditLog({
          entity: 'account',
          entityId: existing.id,
          action: 'update',
          before: {
            ...accountUpdateAuditPayload(existing, balanceChanged),
            ...(normalizedAlias
              ? { alias: { alias: normalizedAlias, changed: aliasWouldChange } }
              : {}),
          },
          after: {
            ...accountUpdateAuditPayload(updatedAccount, balanceChanged),
            ...(normalizedAlias
              ? {
                  alias: {
                    alias: normalizedAlias,
                    accountId: existing.id,
                    changed: aliasWouldChange,
                  },
                }
              : {}),
          },
        })
      })
    }

    return {
      success: true,
      action: 'updated' as const,
      matchedBy: match.matchedBy,
      changed: setClauses.length > 0 || aliasWouldChange,
      account: accountAuditSnapshot(updatedAccount),
      alias: normalizedAlias,
      message: `Updated account "${updatedAccount.name}".`,
    }
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
    dryRun,
  }) => {
    const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [accountId])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]
    if (account.is_archived === 1) return archivedAccountResult(account)
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    const currencyFailure = accountCurrencyChangeFailure(accountId, account.currency, currency)
    if (currencyFailure) return { success: false, message: currencyFailure }

    if (name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`)
      params.push(name)
    }
    if (type !== undefined) {
      setClauses.push(`type = $${paramIdx++}`)
      params.push(type)
    }
    if (currency !== undefined) {
      setClauses.push(`currency = $${paramIdx++}`)
      params.push(currency)
    }
    if (balance !== undefined) {
      setClauses.push(`balance = $${paramIdx++}`)
      params.push(toCentavos(balance))
    }
    if (creditLimit !== undefined) {
      setClauses.push(`credit_limit = $${paramIdx++}`)
      params.push(toCentavos(creditLimit))
    }
    if (statementClosingDay !== undefined) {
      setClauses.push(`statement_closing_day = $${paramIdx++}`)
      params.push(statementClosingDay)
    }
    if (paymentDueDay !== undefined) {
      setClauses.push(`payment_due_day = $${paramIdx++}`)
      params.push(paymentDueDay)
    }

    if (setClauses.length === 0) {
      return { success: false, message: 'No fields to update.' }
    }

    const updatedAccount: AccountRow = {
      ...account,
      name: name ?? account.name,
      type: type ?? account.type,
      currency: currency ?? account.currency,
      balance: balance !== undefined ? toCentavos(balance) : account.balance,
      credit_limit: creditLimit !== undefined ? toCentavos(creditLimit) : account.credit_limit,
      statement_closing_day: statementClosingDay ?? account.statement_closing_day,
      payment_due_day: paymentDueDay ?? account.payment_due_day,
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldUpdate: {
          accountId,
          before: accountAuditSnapshot(account),
          after: accountAuditSnapshot(updatedAccount),
        },
        message: `Dry run: account "${updatedAccount.name}" would be updated.`,
      }
    }

    setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    params.push(accountId)

    transaction(() => {
      const updateResult = execute(
        `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )
      assertSingleRowUpdated(updateResult, `Account ${accountId} could not be updated safely.`)
      const balanceChanged = updatedAccount.balance !== account.balance
      writeAuditLog({
        entity: 'account',
        entityId: accountId,
        action: 'update',
        before: accountUpdateAuditPayload(account, balanceChanged),
        after: accountUpdateAuditPayload(updatedAccount, balanceChanged),
      })
    })

    return {
      success: true,
      message: `Updated account "${name ?? account.name}".`,
    }
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

    if (existing[0].is_archived === 1) return archivedAccountResult(existing[0])

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

const reconcile: ToolDefinition = {
  name: 'reconcile',
  description:
    'Compare an account balance against an observed balance and optionally apply an adjustment transaction.',
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
  execute: async ({ accountId, account, actualBalance, date, apply, source, note }) => {
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
    const actualCentavos = toCentavos(actualBalance)
    const differenceCentavos = actualCentavos - accountRow.balance
    const reconciliationDate = date || dayjs().format('YYYY-MM-DD')
    const baseResult = {
      account: {
        id: accountRow.id,
        name: accountRow.name,
        currency: accountRow.currency,
      },
      storedBalance: fromCentavos(accountRow.balance),
      actualBalance: fromCentavos(actualCentavos),
      difference: fromCentavos(differenceCentavos),
      date: reconciliationDate,
    }

    if (!apply) {
      return {
        success: true,
        dryRun: true,
        applied: false,
        applyRequired: differenceCentavos !== 0,
        ...baseResult,
        requiresConfirmation: differenceCentavos !== 0,
        message:
          differenceCentavos === 0
            ? `Account "${accountRow.name}" already matches ${accountRow.currency} ${actualBalance.toFixed(2)}.`
            : `Account "${accountRow.name}" differs by ${accountRow.currency} ${fromCentavos(differenceCentavos).toFixed(2)}. Re-run with --apply to create an adjustment transaction.`,
      }
    }

    const result = transaction(() => {
      const snapshot = upsertBalanceSnapshot(accountRow.id, reconciliationDate, actualCentavos)

      if (differenceCentavos === 0) {
        return {
          success: true,
          ...baseResult,
          snapshot,
          adjustmentTransaction: null,
          message: `Recorded reconciliation snapshot for "${accountRow.name}"; no adjustment was needed.`,
        }
      }

      const adjustmentId = generateId()
      const adjustmentType = differenceCentavos > 0 ? 'income' : 'expense'
      const adjustmentAmount = Math.abs(differenceCentavos)

      execute(
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, date)
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, NULL, 'posted', $7, $8, $9)`,
        [
          adjustmentId,
          accountRow.id,
          adjustmentType,
          adjustmentAmount,
          accountRow.currency,
          'Balance reconciliation adjustment',
          source ?? null,
          note ?? null,
          reconciliationDate,
        ]
      )
      execute(
        "UPDATE accounts SET balance = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [actualCentavos, accountRow.id]
      )
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
        },
        source: source ?? null,
        note: note ?? null,
      })

      return {
        success: true,
        ...baseResult,
        snapshot,
        adjustmentTransaction: {
          id: adjustmentId,
          type: adjustmentType,
          amount: fromCentavos(adjustmentAmount),
          currency: accountRow.currency,
          description: 'Balance reconciliation adjustment',
          notes: null,
          status: 'posted',
          source: source ?? null,
          note: note ?? null,
          date: reconciliationDate,
        },
        message: `Reconciled "${accountRow.name}" to ${accountRow.currency} ${actualBalance.toFixed(2)} with an adjustment transaction.`,
      }
    })

    return result
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
    if (account.is_archived === 1) return archivedAccountResult(account)

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
  deleteAccount,
  listCategories,
]
