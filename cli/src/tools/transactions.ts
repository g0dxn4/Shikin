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
  isoDate,
  positiveMoneyAmount,
  resolveAccountId,
  crossCurrencyMoveMessage,
  unknownTransactionCurrencyFailure,
  getDistinctCurrencies,
  getCategoryIdentity,
  missingCurrencyRepairFailure,
  hasMissingCurrency,
  normalizeCurrencyCode,
  resolveCategoryId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type TransactionStatus = 'pending' | 'posted' | 'cleared'

type TransactionRow = {
  id: string
  account_id: string
  category_id: string | null
  transfer_to_account_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  status?: TransactionStatus | null
  source?: string | null
  note?: string | null
  recurring_rule_id?: string | null
  date: string
}

type QueriedTransactionRow = {
  id: string
  description: string
  amount: number
  currency: string | null
  type: 'expense' | 'income' | 'transfer'
  date: string
  notes: string | null
  status: TransactionStatus
  source: string | null
  note: string | null
  recurring_rule_id: string | null
  category_name: string
  account_name: string
  transfer_to_account_id: string | null
  transfer_to_account_name: string | null
}

type AccountRef = {
  id: string
  currency: string
}

type RecurringRuleRef = {
  id: string
  account_id: string
  type: 'expense' | 'income' | 'transfer'
  currency: string | null
}

type BalanceImpactResult =
  | { success: true; impacts: Map<string, number> }
  | { success: false; message: string }

type BalanceAuditChange = {
  accountId: string
  deltaCentavos: number
  previousBalanceCentavos: number | null
  newBalanceCentavos: number | null
  previousBalance: number | null
  newBalance: number | null
}

function normalizeTransactionStatus(status: TransactionRow['status']): TransactionStatus {
  return status ?? 'posted'
}

function isBalanceAffectingStatus(status: TransactionRow['status']): boolean {
  return normalizeTransactionStatus(status) !== 'pending'
}

function addImpact(impacts: Map<string, number>, accountId: string, amount: number) {
  impacts.set(accountId, (impacts.get(accountId) ?? 0) + amount)
}

function getBalanceImpact(
  tx: Pick<
    TransactionRow,
    'id' | 'type' | 'amount' | 'account_id' | 'transfer_to_account_id' | 'status'
  >
): BalanceImpactResult {
  const impacts = new Map<string, number>()
  if (!isBalanceAffectingStatus(tx.status)) {
    return { success: true, impacts }
  }

  if (tx.type === 'transfer') {
    if (!tx.transfer_to_account_id) {
      return {
        success: false,
        message: `Transfer transaction ${tx.id} has no destination account. Repair or recreate it before editing it.`,
      }
    }

    addImpact(impacts, tx.account_id, -tx.amount)
    addImpact(impacts, tx.transfer_to_account_id, tx.amount)
    return { success: true, impacts }
  }

  addImpact(impacts, tx.account_id, tx.type === 'income' ? tx.amount : -tx.amount)
  return { success: true, impacts }
}

function diffBalanceImpacts(
  oldImpacts: Map<string, number>,
  newImpacts: Map<string, number>
): Map<string, number> {
  const deltas = new Map<string, number>()
  const accountIds = new Set([...oldImpacts.keys(), ...newImpacts.keys()])

  for (const accountId of accountIds) {
    const delta = (newImpacts.get(accountId) ?? 0) - (oldImpacts.get(accountId) ?? 0)
    if (delta !== 0) deltas.set(accountId, delta)
  }

  return deltas
}

function invertBalanceImpacts(impacts: Map<string, number>): Map<string, number> {
  return new Map([...impacts.entries()].map(([accountId, amount]) => [accountId, -amount]))
}

function sortedBalanceDeltas(deltas: Map<string, number>): Array<[string, number]> {
  return [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function readAccountBalances(accountIds: string[]): Map<string, number> {
  const uniqueAccountIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueAccountIds.length === 0) return new Map()

  const placeholders = uniqueAccountIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows =
    query<{ id: string; balance: number }>(
      `SELECT id, balance FROM accounts WHERE id IN (${placeholders})`,
      uniqueAccountIds
    ) ?? []

  return new Map(rows.map((row) => [row.id, row.balance]))
}

function archivedBalanceMutationFailure(accountIds: string[]) {
  const uniqueAccountIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueAccountIds.length === 0) return null

  const placeholders = uniqueAccountIds.map((_, index) => `$${index + 1}`).join(', ')
  const archivedAccounts =
    query<{ id: string; name: string }>(
      `SELECT id, name FROM accounts WHERE id IN (${placeholders}) AND is_archived = 1 ORDER BY id`,
      uniqueAccountIds
    ) ?? []
  if (archivedAccounts.length === 0) return null

  const archivedLabels = archivedAccounts.map((account) => `${account.name} (${account.id})`)
  return {
    success: false as const,
    reason: 'archived_account_balance_mutation' as const,
    accountIds: archivedAccounts.map((account) => account.id),
    message: `Cannot mutate balances for archived account${archivedAccounts.length === 1 ? '' : 's'} ${archivedLabels.join(', ')}. Unarchive affected accounts before editing or deleting balance-affecting transactions.`,
  }
}

function applyBalanceDeltas(deltas: Map<string, number>) {
  for (const [accountId, delta] of sortedBalanceDeltas(deltas)) {
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [delta, accountId]
    )
  }
}

function buildBalanceAuditChanges(
  deltas: Map<string, number>,
  balancesBefore: Map<string, number>
): BalanceAuditChange[] {
  return sortedBalanceDeltas(deltas).map(([accountId, deltaCentavos]) => {
    const previousBalanceCentavos = balancesBefore.get(accountId) ?? null
    const newBalanceCentavos =
      previousBalanceCentavos === null ? null : previousBalanceCentavos + deltaCentavos

    return {
      accountId,
      deltaCentavos,
      previousBalanceCentavos,
      newBalanceCentavos,
      previousBalance:
        previousBalanceCentavos === null ? null : fromCentavos(previousBalanceCentavos),
      newBalance: newBalanceCentavos === null ? null : fromCentavos(newBalanceCentavos),
    }
  })
}

function transactionAuditSnapshot(tx: TransactionRow) {
  return {
    id: tx.id,
    accountId: tx.account_id,
    categoryId: tx.category_id,
    transferToAccountId: tx.transfer_to_account_id,
    type: tx.type,
    amount: fromCentavos(tx.amount),
    amountCentavos: tx.amount,
    currency: tx.currency,
    description: tx.description,
    notes: tx.notes,
    status: normalizeTransactionStatus(tx.status),
    source: tx.source ?? null,
    note: tx.note ?? null,
    recurringRuleId: tx.recurring_rule_id ?? null,
    date: tx.date,
  }
}

function writeTransactionBalanceAudit({
  action,
  before,
  after,
  balanceDeltas,
  balancesBefore,
}: {
  action: 'create' | 'update' | 'delete'
  before: TransactionRow | null
  after: TransactionRow | null
  balanceDeltas: Map<string, number>
  balancesBefore: Map<string, number>
}) {
  const balanceChanges = buildBalanceAuditChanges(balanceDeltas, balancesBefore)
  writeAuditLog({
    entity: 'transaction',
    entityId: after?.id ?? before?.id ?? null,
    action,
    before: before
      ? {
          transaction: transactionAuditSnapshot(before),
          balances: balanceChanges.map((change) => ({
            accountId: change.accountId,
            balanceCentavos: change.previousBalanceCentavos,
            balance: change.previousBalance,
          })),
        }
      : null,
    after: after
      ? {
          transaction: transactionAuditSnapshot(after),
          balances: balanceChanges.map((change) => ({
            accountId: change.accountId,
            balanceCentavos: change.newBalanceCentavos,
            balance: change.newBalance,
          })),
        }
      : null,
    source: after?.source ?? before?.source ?? null,
    note: after?.note ?? before?.note ?? null,
  })
}

function resolveTransferDestination(transferToAccountId: string | undefined, source: AccountRef) {
  if (!transferToAccountId) {
    return {
      success: false as const,
      message: 'transferToAccountId is required for transfer transactions.',
    }
  }

  if (transferToAccountId === source.id) {
    return {
      success: false as const,
      message: 'Transfer destination account must be different from the source account.',
    }
  }

  const accounts = query<{ id: string; currency: string; is_archived: number }>(
    'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [transferToAccountId]
  )

  if (accounts.length === 0) {
    return {
      success: false as const,
      message: `Transfer destination account ${transferToAccountId} not found.`,
    }
  }

  const destination = accounts[0]
  if (destination.is_archived === 1) {
    return {
      success: false as const,
      message: `Transfer destination account ${transferToAccountId} is archived. Unarchive it before using it for new writes.`,
    }
  }

  if (destination.currency !== source.currency) {
    return {
      success: false as const,
      message: `Cannot transfer from ${source.currency} to ${destination.currency}. Cross-currency transfers are not supported because no FX conversion is applied.`,
    }
  }

  return { success: true as const, id: destination.id, currency: destination.currency }
}

function resolveRecurringRuleId(
  recurringRuleId: string | null | undefined,
  transactionRef?: { accountId: string; type: TransactionRow['type']; currency: string | null }
) {
  if (!recurringRuleId) {
    return { success: true as const, id: null }
  }

  const rules = query<RecurringRuleRef>(
    'SELECT id, account_id, type, currency FROM recurring_rules WHERE id = $1 LIMIT 1',
    [recurringRuleId]
  )

  if (rules.length === 0) {
    return {
      success: false as const,
      message: `Recurring rule ${recurringRuleId} not found.`,
    }
  }

  const rule = rules[0]
  if (transactionRef) {
    if (rule.account_id !== transactionRef.accountId) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} belongs to account ${rule.account_id}, not ${transactionRef.accountId}.`,
      }
    }
    if (rule.type !== transactionRef.type) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} is for ${rule.type} transactions, not ${transactionRef.type}.`,
      }
    }
    const ruleCurrency = normalizeCurrencyCode(rule.currency)
    const transactionCurrency = normalizeCurrencyCode(transactionRef.currency)
    if (!ruleCurrency) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} has no stored currency. Repair or recreate it before linking transactions.`,
      }
    }
    if (!transactionCurrency) {
      return {
        success: false as const,
        message: `Transaction currency is unknown; cannot link recurring rule ${recurringRuleId}.`,
      }
    }
    if (ruleCurrency !== transactionCurrency) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} uses ${ruleCurrency}, not ${transactionCurrency}.`,
      }
    }
  }

  return { success: true as const, id: rule.id }
}

const addTransaction: ToolDefinition = {
  name: 'add-transaction',
  description:
    'Add a new financial transaction (expense, income, or transfer). Use this when the user wants to record spending, earnings, or money movement between accounts.',
  schema: z.object({
    amount: positiveMoneyAmount(
      'The transaction amount in the main currency unit (e.g. 12.50, not cents; max 1,000,000,000)'
    ),
    type: z.enum(['expense', 'income', 'transfer']).describe('The type of transaction'),
    description: boundedText('Description', 'A short description of the transaction', 200),
    category: boundedText(
      'Category',
      'Category name (e.g. "Food & Dining", "Salary"). Must resolve to one existing category.',
      120
    ).optional(),
    date: isoDate('Transaction date in YYYY-MM-DD format. Defaults to today.').optional(),
    notes: boundedText('Notes', 'Additional notes about the transaction', 1000).optional(),
    note: boundedText(
      'Note',
      'Assistant changelog note to store with the transaction',
      1000
    ).optional(),
    source: boundedText(
      'Source',
      'Assistant or origin label to store with the transaction',
      120
    ).optional(),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .default('posted')
      .describe('Transaction status. Pending transactions do not affect account balances.'),
    recurringRuleId: boundedText(
      'Recurring rule ID',
      'Optional recurring rule ID linked to this transaction',
      128
    ).optional(),
    accountId: boundedText(
      'Account ID',
      'Optional account ID to apply the transaction to. Required when multiple accounts exist.',
      128
    ).optional(),
    account: boundedText(
      'Account alias',
      'Optional account alias, exact account ID, or exact account name. Required when multiple accounts exist.',
      128
    ).optional(),
    transferToAccountId: boundedText(
      'Transfer destination account ID',
      'Destination account ID for transfer transactions. Required when type is transfer.',
      128
    ).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the transaction without writing it'),
  }),
  execute: async ({
    amount,
    type,
    description,
    category,
    date,
    notes,
    note,
    source,
    status,
    recurringRuleId,
    accountId,
    account,
    transferToAccountId,
    dryRun,
  }) => {
    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const txDate = date || dayjs().format('YYYY-MM-DD')
    const transactionNotes = notes ?? null
    const transactionSource = source ?? null
    const transactionNote = note ?? null
    const transactionStatus = status ?? 'posted'
    const linkedRecurringRuleId = recurringRuleId ?? null

    return transaction(() => {
      const resolvedCategory =
        type === 'transfer'
          ? { success: true as const, id: null, name: null }
          : resolveCategoryId(category)
      if (!resolvedCategory.success) {
        return { success: false, message: resolvedCategory.message }
      }

      const resolvedAccount = resolveAccountId(accountId, account)
      if (!resolvedAccount.success) {
        return {
          success: false,
          message: resolvedAccount.message,
        }
      }

      const resolvedTransferDestination =
        type === 'transfer'
          ? resolveTransferDestination(transferToAccountId, resolvedAccount)
          : { success: true as const, id: null }

      if (!resolvedTransferDestination.success) {
        return { success: false, message: resolvedTransferDestination.message }
      }

      const resolvedRecurringRule = resolveRecurringRuleId(linkedRecurringRuleId, {
        accountId: resolvedAccount.id,
        type,
        currency: resolvedAccount.currency,
      })
      if (!resolvedRecurringRule.success) {
        return { success: false, message: resolvedRecurringRule.message }
      }

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldCreate: {
            id,
            accountId: resolvedAccount.id,
            transferToAccountId: resolvedTransferDestination.id,
            amount,
            currency: resolvedAccount.currency,
            type,
            description,
            category: resolvedCategory.name,
            date: txDate,
            notes: transactionNotes,
            status: transactionStatus,
            source: transactionSource,
            note: transactionNote,
            recurringRuleId: resolvedRecurringRule.id,
          },
          message: `Dry run: ${type} transaction for ${resolvedAccount.currency} ${amount.toFixed(2)} would be created.`,
        }
      }

      const newTransaction: TransactionRow = {
        id,
        account_id: resolvedAccount.id,
        category_id: resolvedCategory.id,
        transfer_to_account_id: resolvedTransferDestination.id,
        type,
        amount: amountCentavos,
        currency: resolvedAccount.currency,
        description,
        notes: transactionNotes,
        status: transactionStatus,
        source: transactionSource,
        note: transactionNote,
        recurring_rule_id: resolvedRecurringRule.id,
        date: txDate,
      }
      const balanceImpact = getBalanceImpact(newTransaction)
      if (!balanceImpact.success) {
        return { success: false, message: balanceImpact.message }
      }
      const balanceDeltas = balanceImpact.impacts
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])

      execute(
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          resolvedAccount.id,
          resolvedCategory.id,
          resolvedTransferDestination.id,
          type,
          amountCentavos,
          resolvedAccount.currency,
          description,
          transactionNotes,
          transactionStatus,
          transactionSource,
          transactionNote,
          resolvedRecurringRule.id,
          txDate,
        ]
      )

      applyBalanceDeltas(balanceDeltas)
      writeTransactionBalanceAudit({
        action: 'create',
        before: null,
        after: newTransaction,
        balanceDeltas,
        balancesBefore,
      })

      return {
        success: true,
        transaction: {
          id,
          accountId: resolvedAccount.id,
          transferToAccountId: resolvedTransferDestination.id,
          amount,
          type,
          description,
          category: resolvedCategory.name,
          date: txDate,
          notes: transactionNotes,
          currency: resolvedAccount.currency,
          status: transactionStatus,
          source: transactionSource,
          note: transactionNote,
          recurringRuleId: resolvedRecurringRule.id,
        },
        message: `Added ${type}: $${amount.toFixed(2)} for "${description}" on ${txDate}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 2. update-transaction
// ---------------------------------------------------------------------------

const updateTransaction: ToolDefinition = {
  name: 'update-transaction',
  description:
    'Update an existing transaction. Use this when the user wants to change the amount, description, category, date, or other details of a transaction.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to update', 128),
    amount: positiveMoneyAmount('New amount in the main currency unit (e.g. 12.50)').optional(),
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('New transaction type'),
    description: boundedText('Description', 'New description', 200).optional(),
    category: boundedText(
      'Category',
      'New category name — will match the closest existing category',
      120
    ).optional(),
    date: isoDate('New date in YYYY-MM-DD format').optional(),
    notes: z.string().max(1000).optional().describe('New notes. Pass an empty string to clear.'),
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('New assistant changelog note. Pass an empty string to clear.'),
    source: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('New assistant or origin label. Pass an empty string to clear.'),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .describe('New transaction status. Pending transactions do not affect account balances.'),
    recurringRuleId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('New linked recurring rule ID. Pass an empty string to clear.'),
    accountId: boundedText(
      'Account ID',
      'New account ID to move the transaction to',
      128
    ).optional(),
    transferToAccountId: boundedText(
      'Transfer destination account ID',
      'Destination account ID for transfer transactions',
      128
    ).optional(),
  }),
  execute: async ({
    transactionId,
    amount,
    type,
    description,
    category,
    date,
    notes,
    note,
    source,
    status,
    recurringRuleId,
    accountId,
    transferToAccountId,
  }) => {
    return transaction(() => {
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      if (!tx.currency) {
        return unknownTransactionCurrencyFailure(tx)
      }

      const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const newStatus = status ?? normalizeTransactionStatus(tx.status)
      const isMovingAccounts = accountId !== undefined && accountId !== oldAccountId
      const sourceCurrency = tx.currency
      let resolvedAccount:
        | { success: true; id: string; currency: string }
        | { success: false; message: string }
        | null = null

      if (isMovingAccounts) {
        resolvedAccount = resolveAccountId(accountId)
        if (!resolvedAccount.success) {
          return { success: false, message: resolvedAccount.message }
        }

        if (sourceCurrency && resolvedAccount.currency !== sourceCurrency) {
          return {
            success: false,
            message: crossCurrencyMoveMessage(
              'transaction',
              sourceCurrency,
              resolvedAccount.currency
            ),
          }
        }
      }

      const newAccountId = resolvedAccount?.success ? resolvedAccount.id : accountId || oldAccountId
      const newCurrency = sourceCurrency

      let newCategoryId = tx.category_id
      if (newType === 'transfer') {
        newCategoryId = null
      } else if (category !== undefined) {
        const resolvedCategory = resolveCategoryId(category)
        if (!resolvedCategory.success) {
          return { success: false, message: resolvedCategory.message }
        }
        newCategoryId = resolvedCategory.id
      }

      if (newType !== 'transfer' && transferToAccountId !== undefined) {
        return {
          success: false,
          message: 'transferToAccountId can only be used when the transaction type is transfer.',
        }
      }

      let newTransferToAccountId: string | null = null
      if (newType === 'transfer') {
        const resolvedDestination = resolveTransferDestination(
          transferToAccountId ?? tx.transfer_to_account_id ?? undefined,
          {
            id: newAccountId,
            currency: newCurrency,
          }
        )
        if (!resolvedDestination.success) {
          return { success: false, message: resolvedDestination.message }
        }
        newTransferToAccountId = resolvedDestination.id
      }

      let newRecurringRuleId = tx.recurring_rule_id ?? null
      if (recurringRuleId !== undefined) {
        newRecurringRuleId = recurringRuleId === '' ? null : recurringRuleId
      }

      const updatedTx: TransactionRow = {
        ...tx,
        amount: newAmount,
        type: newType,
        description: description !== undefined ? description : tx.description,
        category_id: newCategoryId,
        date: date || tx.date,
        notes: notes !== undefined ? (notes === '' ? null : notes) : tx.notes,
        account_id: newAccountId,
        currency: newCurrency,
        transfer_to_account_id: newTransferToAccountId,
        status: newStatus,
        source: source !== undefined ? (source === '' ? null : source) : (tx.source ?? null),
        note: note !== undefined ? (note === '' ? null : note) : (tx.note ?? null),
        recurring_rule_id: newRecurringRuleId,
      }

      if (updatedTx.recurring_rule_id) {
        const resolvedRecurringRule = resolveRecurringRuleId(updatedTx.recurring_rule_id, {
          accountId: updatedTx.account_id,
          type: updatedTx.type,
          currency: updatedTx.currency,
        })
        if (!resolvedRecurringRule.success) {
          return { success: false, message: resolvedRecurringRule.message }
        }
        updatedTx.recurring_rule_id = resolvedRecurringRule.id
      }

      const oldImpact = getBalanceImpact(tx)
      if (!oldImpact.success) {
        return { success: false, message: oldImpact.message }
      }
      const newImpact = getBalanceImpact(updatedTx)
      if (!newImpact.success) {
        return { success: false, message: newImpact.message }
      }
      const balanceDeltas = diffBalanceImpacts(oldImpact.impacts, newImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      applyBalanceDeltas(balanceDeltas)

      const updateResult = execute(
        `UPDATE transactions
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7, currency = $8, transfer_to_account_id = $9, status = $10, source = $11, note = $12, recurring_rule_id = $13,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $14`,
        [
          updatedTx.amount,
          updatedTx.type,
          updatedTx.description,
          updatedTx.category_id,
          updatedTx.date,
          updatedTx.notes,
          updatedTx.account_id,
          updatedTx.currency,
          updatedTx.transfer_to_account_id,
          updatedTx.status,
          updatedTx.source,
          updatedTx.note,
          updatedTx.recurring_rule_id,
          transactionId,
        ]
      )

      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Transaction ${transactionId} could not be updated safely.`)
      }

      writeTransactionBalanceAudit({
        action: 'update',
        before: tx,
        after: updatedTx,
        balanceDeltas,
        balancesBefore,
      })

      const displayAmount = amount !== undefined ? amount : fromCentavos(oldAmountCentavos)

      return {
        success: true,
        transaction: {
          id: transactionId,
          amount: displayAmount,
          type: updatedTx.type,
          description: updatedTx.description,
          accountId: updatedTx.account_id,
          transferToAccountId: updatedTx.transfer_to_account_id,
          date: updatedTx.date,
          notes: updatedTx.notes,
          status: updatedTx.status,
          source: updatedTx.source,
          note: updatedTx.note,
          recurringRuleId: updatedTx.recurring_rule_id,
        },
        message: `Updated transaction ${transactionId}: $${displayAmount.toFixed(2)} ${updatedTx.type}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 3. delete-transaction
// ---------------------------------------------------------------------------

const deleteTransaction: ToolDefinition = {
  name: 'delete-transaction',
  description:
    'Delete a transaction. Use this when the user wants to remove a transaction. The account balance will be adjusted accordingly.',
  schema: z.object({
    transactionId: z.string().describe('The ID of the transaction to delete'),
  }),
  execute: async ({ transactionId }) => {
    return transaction(() => {
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]

      const balanceImpact = getBalanceImpact(tx)
      if (!balanceImpact.success) {
        return { success: false, message: balanceImpact.message }
      }
      const balanceDeltas = invertBalanceImpacts(balanceImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      applyBalanceDeltas(balanceDeltas)

      execute('DELETE FROM transactions WHERE id = $1', [transactionId])
      writeTransactionBalanceAudit({
        action: 'delete',
        before: tx,
        after: null,
        balanceDeltas,
        balancesBefore,
      })

      return {
        success: true,
        message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}" from ${tx.date}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 4. query-transactions
// ---------------------------------------------------------------------------

const queryTransactions: ToolDefinition = {
  name: 'query-transactions',
  description:
    'Search and filter transactions. Use this when the user asks about their transactions, wants to find specific ones, or asks questions about their financial history.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    categoryId: boundedText('Category ID', 'Filter by category ID', 128).optional(),
    type: z
      .enum(['expense', 'income', 'transfer'])
      .optional()
      .describe('Filter by transaction type'),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .describe('Filter by transaction status'),
    startDate: isoDate('Start date (YYYY-MM-DD) inclusive').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) inclusive').optional(),
    search: boundedText(
      'Search term',
      'Search term to match against transaction descriptions',
      200
    ).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of results (default 20, max 100)'),
  }),
  execute: async ({ accountId, categoryId, type, status, startDate, endDate, search, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (accountId) {
      paramIndex++
      const sourceAccountParam = paramIndex
      paramIndex++
      const destinationAccountParam = paramIndex
      conditions.push(
        `(t.account_id = $${sourceAccountParam} OR t.transfer_to_account_id = $${destinationAccountParam})`
      )
      params.push(accountId, accountId)
    }
    if (categoryId) {
      paramIndex++
      conditions.push(`t.category_id = $${paramIndex}`)
      params.push(categoryId)
    }
    if (type) {
      paramIndex++
      conditions.push(`t.type = $${paramIndex}`)
      params.push(type)
    }
    if (status) {
      paramIndex++
      conditions.push(`COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = $${paramIndex}`)
      params.push(status)
    }
    if (startDate) {
      paramIndex++
      conditions.push(`t.date >= $${paramIndex}`)
      params.push(startDate)
    }
    if (endDate) {
      paramIndex++
      conditions.push(`t.date <= $${paramIndex}`)
      params.push(endDate)
    }
    if (search) {
      paramIndex++
      conditions.push(`t.description LIKE $${paramIndex}`)
      params.push(`%${search}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    const limitParam = `$${paramIndex}`
    params.push(limit)

    const transactions = await query<QueriedTransactionRow>(
      `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.notes, t.status, t.source, t.note, t.recurring_rule_id, t.transfer_to_account_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name,
              ta.name as transfer_to_account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ${limitParam}`,
      params
    )

    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      params.slice(0, -1)
    )

    const totalMatched = countResult[0]?.count || 0

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        currency: t.currency,
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        transferToAccountId: t.transfer_to_account_id,
        transferToAccount: t.transfer_to_account_name,
        date: t.date,
        notes: t.notes,
        status: t.status,
        source: t.source,
        note: t.note,
        recurringRuleId: t.recurring_rule_id,
      })),
      count: transactions.length,
      totalMatched,
      message:
        transactions.length === 0
          ? 'No transactions found matching your criteria.'
          : `Found ${totalMatched} transaction${totalMatched !== 1 ? 's' : ''}${transactions.length < totalMatched ? `, showing first ${transactions.length}` : ''}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 5. get-spending-summary
// ---------------------------------------------------------------------------

const getSpendingSummary: ToolDefinition = {
  name: 'get-spending-summary',
  description:
    'Get a summary of spending by category for a given time period. Use this when the user asks about their spending, expenses, or budget status.',
  schema: z.object({
    period: z
      .enum(['week', 'month', 'year', 'custom'])
      .optional()
      .default('month')
      .describe('The time period to summarize'),
    startDate: isoDate('Start date (YYYY-MM-DD) for custom period').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) for custom period').optional(),
  }),
  execute: async ({ period, startDate, endDate }) => {
    let start: string
    let end: string

    if (period === 'custom' && (!startDate || !endDate)) {
      return {
        success: false,
        message: 'Custom spending summaries require both startDate and endDate.',
      }
    }

    if (period === 'custom' && startDate && endDate) {
      start = startDate
      end = endDate
      if (dayjs(start).isAfter(dayjs(end), 'day')) {
        return {
          success: false,
          message: 'Custom spending summaries require startDate to be on or before endDate.',
        }
      }
    } else {
      const now = dayjs()
      end = now.format('YYYY-MM-DD')
      switch (period) {
        case 'week':
          start = now.subtract(6, 'day').format('YYYY-MM-DD')
          break
        case 'year':
          start = now.startOf('year').format('YYYY-MM-DD')
          break
        default:
          start = now.startOf('month').format('YYYY-MM-DD')
      }
    }

    const spending = await query<{
      currency: string
      category_id: string | null
      category_name: string
      total: number
      count: number
    }>(
      `SELECT
         t.currency as currency,
         t.category_id as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.type = 'expense'
          AND COALESCE(NULLIF(TRIM(t.status), ''), 'posted') IN ('posted', 'cleared')
          AND t.date >= $1
          AND t.date <= $2
        GROUP BY t.currency, t.category_id, c.name
        ORDER BY t.currency ASC, total DESC`,
      [start, end]
    )

    const totals = await query<{ currency: string; type: string; total: number }>(
      `SELECT currency, type, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE type IN ('income', 'expense')
         AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
         AND date >= $1 AND date <= $2
       GROUP BY currency, type`,
      [start, end]
    )

    if (hasMissingCurrency([...spending, ...totals])) {
      return missingCurrencyRepairFailure('Spending summary')
    }

    const currencies = getDistinctCurrencies([...spending, ...totals])
    const totalsByCurrency = currencies.map((currency) => {
      const expenses =
        totals.find((row) => row.currency === currency && row.type === 'expense')?.total || 0
      const income =
        totals.find((row) => row.currency === currency && row.type === 'income')?.total || 0
      return {
        currency,
        totalExpenses: fromCentavos(expenses),
        totalIncome: fromCentavos(income),
        netSavings: fromCentavos(income - expenses),
      }
    })
    const singleCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null
    const emptyPeriodTotals =
      totalsByCurrency.length === 0 ? { totalExpenses: 0, totalIncome: 0, netSavings: 0 } : null

    return {
      period: { start, end },
      mixedCurrency: totalsByCurrency.length > 1,
      totalExpenses: singleCurrency?.totalExpenses ?? emptyPeriodTotals?.totalExpenses ?? null,
      totalIncome: singleCurrency?.totalIncome ?? emptyPeriodTotals?.totalIncome ?? null,
      netSavings: singleCurrency?.netSavings ?? emptyPeriodTotals?.netSavings ?? null,
      totalsByCurrency,
      byCategory: spending.map((row) => ({
        currency: row.currency,
        ...getCategoryIdentity(row.category_id, row.category_name),
        amount: fromCentavos(row.total),
        transactionCount: row.count,
        percentage:
          (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
            ?.totalExpenses ?? 0) > 0
            ? Math.round(
                (fromCentavos(row.total) /
                  (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
                    ?.totalExpenses ?? 0)) *
                  100
              )
            : 0,
      })),
      message:
        spending.length === 0
          ? `No expenses found for ${start} to ${end}.`
          : singleCurrency
            ? `Total spending from ${start} to ${end}: ${singleCurrency.currency} ${singleCurrency.totalExpenses.toFixed(2)} across ${spending.length} categories.`
            : `Found spending from ${start} to ${end} across ${totalsByCurrency.length} currencies. See totalsByCurrency and byCategory for per-currency breakdowns; no FX conversion was applied.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 6. list-accounts
// ---------------------------------------------------------------------------

export const transactionsTools: ToolDefinition[] = [
  addTransaction,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  getSpendingSummary,
]
