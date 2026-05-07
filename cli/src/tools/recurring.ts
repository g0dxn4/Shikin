import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  advanceDate,
  boundedText,
  isoDate,
  resolveAccountId,
  recurringRulesHasCurrencyColumn,
  crossCurrencyMoveMessage,
  unknownRecurringRuleCurrencyFailure,
  normalizeCurrencyCode,
  invalidAccountCurrencyMessage,
  unsupportedRecurringTransferFailure,
  resolveCategoryId,
  type ToolDefinition,
} from './shared.js'

type RecurringRuleRow = {
  id: string
  description: string
  amount: number
  type: 'expense' | 'income' | 'transfer'
  frequency: string
  next_date: string
  end_date: string | null
  account_id: string
  category_id: string | null
  notes: string | null
  active: number
  currency: string | null
  account_name?: string | null
  category_name?: string | null
  account_currency?: string | null
  account_is_archived?: number | null
}

type CountRow = { count: number }

type RecurringExpectedRuleRow = RecurringRuleRow & {
  account_name: string | null
  account_currency: string | null
  category_name: string | null
}

type RecurringPaidTransactionRow = {
  id: string
  recurring_rule_id: string | null
  account_id: string
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string
  description: string
  date: string
  status: string | null
}

type RecurringOccurrence = {
  rule: RecurringExpectedRuleRow
  dueDate: string
  amount: number
  currency: string
}

async function countLinkedRecurringTransactions(ruleId: string) {
  const rows = await query<CountRow>(
    'SELECT COUNT(*) as count FROM transactions WHERE recurring_rule_id = $1',
    [ruleId]
  )
  return rows?.[0]?.count ?? 0
}

function normalizeMatcherText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function descriptionMatchesRecurringRule(ruleDescription: string, transactionDescription: string) {
  const rule = normalizeMatcherText(ruleDescription)
  const transaction = normalizeMatcherText(transactionDescription)
  if (!rule || !transaction) return false
  if (rule === transaction) return true
  if (
    (rule.length >= 8 || transaction.length >= 8) &&
    (rule.includes(transaction) || transaction.includes(rule))
  ) {
    return true
  }

  const ruleTokens = new Set(rule.split(' ').filter((token) => token.length >= 4))
  const transactionTokens = new Set(transaction.split(' ').filter((token) => token.length >= 4))
  if (ruleTokens.size === 0 || transactionTokens.size === 0) return false

  let shared = 0
  for (const token of ruleTokens) {
    if (transactionTokens.has(token)) shared += 1
  }
  const smallerTokenSetSize = Math.min(ruleTokens.size, transactionTokens.size)
  return shared >= 2 && shared / smallerTokenSetSize >= 0.75
}

function isPaidTransactionStatus(status: string | null | undefined) {
  const normalized = typeof status === 'string' && status.trim() ? status.trim() : 'posted'
  return normalized === 'posted' || normalized === 'cleared'
}

function occurrencePaymentStatus(
  matched: RecurringPaidTransactionRow | null,
  dueDate: string,
  asOfDate: string
) {
  if (matched && isPaidTransactionStatus(matched.status)) return 'paid' as const
  return dayjs(dueDate).isBefore(dayjs(asOfDate), 'day') ? ('late' as const) : ('unpaid' as const)
}

function buildRecurringOccurrences(
  rules: RecurringExpectedRuleRow[],
  startDate: string,
  endDate: string
): RecurringOccurrence[] {
  const occurrences: RecurringOccurrence[] = []

  for (const rule of rules) {
    const currency =
      normalizeCurrencyCode(rule.currency) || normalizeCurrencyCode(rule.account_currency)
    if (!currency) continue

    let occurrenceDate = rule.next_date
    let guard = 0
    while (occurrenceDate < startDate && (!rule.end_date || occurrenceDate <= rule.end_date)) {
      occurrenceDate = advanceDate(occurrenceDate, rule.frequency)
      guard += 1
      if (guard > 5000) break
    }

    while (occurrenceDate <= endDate && (!rule.end_date || occurrenceDate <= rule.end_date)) {
      occurrences.push({
        rule,
        dueDate: occurrenceDate,
        amount: rule.amount,
        currency,
      })
      occurrenceDate = advanceDate(occurrenceDate, rule.frequency)
      guard += 1
      if (guard > 5000) break
    }
  }

  return occurrences.sort((a, b) =>
    a.dueDate === b.dueDate
      ? a.rule.description.localeCompare(b.rule.description)
      : a.dueDate.localeCompare(b.dueDate)
  )
}

function findRecurringMatch(input: {
  occurrence: RecurringOccurrence
  transactions: RecurringPaidTransactionRow[]
  usedTransactionIds: Set<string>
  fallbackWindowDays: number
}): {
  transaction: RecurringPaidTransactionRow
  method: 'recurring_rule_id' | 'fallback_heuristic'
} | null {
  const { occurrence, transactions, usedTransactionIds, fallbackWindowDays } = input
  const sameShape = (tx: RecurringPaidTransactionRow) =>
    !usedTransactionIds.has(tx.id) &&
    tx.account_id === occurrence.rule.account_id &&
    tx.type === occurrence.rule.type &&
    tx.amount === occurrence.amount &&
    normalizeCurrencyCode(tx.currency) === occurrence.currency &&
    Math.abs(dayjs(tx.date).diff(dayjs(occurrence.dueDate), 'day')) <= fallbackWindowDays

  const byLink = transactions
    .filter((tx) => tx.recurring_rule_id === occurrence.rule.id && sameShape(tx))
    .sort(
      (a, b) =>
        Math.abs(dayjs(a.date).diff(dayjs(occurrence.dueDate), 'day')) -
        Math.abs(dayjs(b.date).diff(dayjs(occurrence.dueDate), 'day'))
    )
  if (byLink[0]) return { transaction: byLink[0], method: 'recurring_rule_id' }

  const fallback = transactions
    .filter(
      (tx) =>
        !tx.recurring_rule_id &&
        sameShape(tx) &&
        descriptionMatchesRecurringRule(occurrence.rule.description, tx.description)
    )
    .sort(
      (a, b) =>
        Math.abs(dayjs(a.date).diff(dayjs(occurrence.dueDate), 'day')) -
        Math.abs(dayjs(b.date).diff(dayjs(occurrence.dueDate), 'day'))
    )

  return fallback[0] ? { transaction: fallback[0], method: 'fallback_heuristic' } : null
}

function addCurrencyTotal(
  totals: Map<string, number>,
  currency: string,
  amountCentavos: number
): void {
  totals.set(currency, (totals.get(currency) ?? 0) + amountCentavos)
}

function currencyTotalsSnapshot(totals: Map<string, number>) {
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountCentavos]) => ({
      currency,
      amount: fromCentavos(amountCentavos),
      amountCentavos,
    }))
}

const manageRecurringTransaction: ToolDefinition = {
  name: 'manage-recurring-transaction',
  description:
    'Create, update, delete, list, or toggle recurring transaction rules. Recurring rules automatically generate transactions on a schedule.',
  schema: z.object({
    action: z
      .enum(['create', 'update', 'delete', 'list', 'toggle'])
      .describe('The action to perform on recurring rules'),
    ruleId: z
      .string()
      .optional()
      .describe('Required for update/delete/toggle. The recurring rule ID.'),
    description: z.string().optional().describe('Description of the recurring transaction'),
    amount: z.number().positive().optional().describe('Amount in the main currency unit'),
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('Transaction type'),
    frequency: z
      .enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .describe('How often this recurs'),
    nextDate: z.string().optional().describe('Next occurrence date in YYYY-MM-DD format'),
    endDate: z.string().optional().describe('Optional end date in YYYY-MM-DD format'),
    category: z.string().optional().describe('Category name to match'),
    notes: z.string().optional().describe('Optional notes'),
    accountId: boundedText(
      'Account ID',
      'Optional account ID for the recurring rule. Required when multiple accounts exist.',
      128
    ).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview create/update/delete/toggle actions without writing them'),
  }),
  execute: async ({
    action,
    ruleId,
    description,
    amount,
    type,
    frequency,
    nextDate,
    endDate,
    category,
    notes,
    accountId,
    dryRun,
  }) => {
    if (action === 'list') {
      const rules = await query<RecurringRuleRow>(
        `SELECT r.*, a.name as account_name, c.name as category_name
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         LEFT JOIN categories c ON r.category_id = c.id
         ORDER BY r.active DESC, r.next_date ASC`
      )

      if (rules.length === 0) {
        return { success: true, rules: [], message: 'No recurring rules found.' }
      }

      return {
        success: true,
        rules: rules.map((r) => ({
          id: r.id,
          description: r.description,
          amount: fromCentavos(r.amount),
          type: r.type,
          frequency: r.frequency,
          nextDate: r.next_date,
          endDate: r.end_date,
          active: !!r.active,
          account: r.account_name,
          category: r.category_name,
        })),
        message: `Found ${rules.length} recurring rule(s).`,
      }
    }

    if (action === 'create') {
      if (!description || !amount || !type || !frequency) {
        return {
          success: false,
          message:
            'description, amount, type, and frequency are required to create a recurring rule.',
        }
      }

      if (type === 'transfer') {
        return unsupportedRecurringTransferFailure()
      }

      const resolvedCategory = resolveCategoryId(category)
      if (!resolvedCategory.success) {
        return {
          success: false,
          message: resolvedCategory.message,
        }
      }

      const resolvedAccount = resolveAccountId(accountId)
      if (!resolvedAccount.success) {
        return {
          success: false,
          message: resolvedAccount.message,
        }
      }
      const recurringRuleCurrency = normalizeCurrencyCode(resolvedAccount.currency)
      if (recurringRuleCurrency === '') {
        return {
          success: false,
          message: invalidAccountCurrencyMessage(resolvedAccount.id),
        }
      }

      const id = generateId()
      const amountCentavos = toCentavos(amount)
      const resolvedNextDate = nextDate || dayjs().format('YYYY-MM-DD')
      const hasCurrencyColumn = recurringRulesHasCurrencyColumn()

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldCreate: {
            id,
            description,
            amount,
            amountCentavos,
            type,
            frequency,
            nextDate: resolvedNextDate,
            endDate: endDate ?? null,
            accountId: resolvedAccount.id,
            categoryId: resolvedCategory.id,
            notes: notes ?? null,
            currency: recurringRuleCurrency,
          },
          message: `Dry run: ${frequency} recurring ${type} "${description}" would be created starting ${resolvedNextDate}.`,
        }
      }

      await execute(
        hasCurrencyColumn
          ? `INSERT INTO recurring_rules (id, description, amount, type, frequency, next_date, end_date, account_id, category_id, notes, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
          : `INSERT INTO recurring_rules (id, description, amount, type, frequency, next_date, end_date, account_id, category_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        hasCurrencyColumn
          ? [
              id,
              description,
              amountCentavos,
              type,
              frequency,
              resolvedNextDate,
              endDate ?? null,
              resolvedAccount.id,
              resolvedCategory.id,
              notes ?? null,
              recurringRuleCurrency,
            ]
          : [
              id,
              description,
              amountCentavos,
              type,
              frequency,
              resolvedNextDate,
              endDate ?? null,
              resolvedAccount.id,
              resolvedCategory.id,
              notes ?? null,
            ]
      )

      return {
        success: true,
        rule: { id, description, amount, type, frequency, nextDate: resolvedNextDate },
        message: `Created ${frequency} recurring ${type}: "$${amount.toFixed(2)} — ${description}" starting ${resolvedNextDate}.`,
      }
    }

    if (action === 'update') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for update.' }
      }

      const existing = await query<RecurringRuleRow>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const rule = existing[0]
      if (normalizeCurrencyCode(rule.currency) === '') {
        return unknownRecurringRuleCurrencyFailure(rule)
      }

      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1
      let resolvedAccount:
        | { success: true; id: string; currency: string }
        | { success: false; message: string }
        | null = null
      const sourceCurrency = normalizeCurrencyCode(rule.currency)
      let updatedCategoryId = rule.category_id

      if (description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`)
        params.push(description)
      }
      if (amount !== undefined) {
        setClauses.push(`amount = $${paramIdx++}`)
        params.push(toCentavos(amount))
      }
      if (type !== undefined) {
        if (type === 'transfer') {
          return unsupportedRecurringTransferFailure()
        }
        setClauses.push(`type = $${paramIdx++}`)
        params.push(type)
      }
      if (frequency !== undefined) {
        setClauses.push(`frequency = $${paramIdx++}`)
        params.push(frequency)
      }
      if (nextDate !== undefined) {
        setClauses.push(`next_date = $${paramIdx++}`)
        params.push(nextDate)
      }
      if (endDate !== undefined) {
        setClauses.push(`end_date = $${paramIdx++}`)
        params.push(endDate)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(notes)
      }

      if (category !== undefined) {
        const resolvedCategory = resolveCategoryId(category)
        if (!resolvedCategory.success) {
          return { success: false, message: resolvedCategory.message }
        }
        setClauses.push(`category_id = $${paramIdx++}`)
        params.push(resolvedCategory.id)
        updatedCategoryId = resolvedCategory.id
      }

      if (accountId !== undefined) {
        resolvedAccount = resolveAccountId(accountId)
        if (!resolvedAccount.success) {
          return { success: false, message: resolvedAccount.message }
        }

        if (
          rule.account_id !== resolvedAccount.id &&
          sourceCurrency !== normalizeCurrencyCode(resolvedAccount.currency)
        ) {
          return {
            success: false,
            message: crossCurrencyMoveMessage(
              'recurring rule',
              sourceCurrency,
              resolvedAccount.currency
            ),
          }
        }

        setClauses.push(`account_id = $${paramIdx++}`)
        params.push(resolvedAccount.id)
      }

      if (recurringRulesHasCurrencyColumn()) {
        const isMovingAccounts = resolvedAccount?.success && resolvedAccount.id !== rule.account_id
        if (isMovingAccounts) {
          setClauses.push(`currency = $${paramIdx++}`)
          params.push(sourceCurrency)
        }
      }

      if (setClauses.length === 0) {
        return { success: false, message: 'No fields to update.' }
      }

      const updatedRule = {
        id: rule.id,
        description: description ?? rule.description,
        amount: amount !== undefined ? amount : fromCentavos(rule.amount),
        amountCentavos: amount !== undefined ? toCentavos(amount) : rule.amount,
        type: type ?? rule.type,
        frequency: frequency ?? rule.frequency,
        nextDate: nextDate ?? rule.next_date,
        endDate: endDate !== undefined ? endDate : rule.end_date,
        accountId: resolvedAccount?.success ? resolvedAccount.id : rule.account_id,
        categoryId: updatedCategoryId,
        notes: notes !== undefined ? notes : rule.notes,
        active: Boolean(rule.active),
        currency: sourceCurrency,
      }

      const identityChanged =
        updatedRule.type !== rule.type || updatedRule.accountId !== rule.account_id
      if (identityChanged) {
        const linkedTransactionCount = await countLinkedRecurringTransactions(rule.id)
        if (linkedTransactionCount > 0) {
          return {
            success: false,
            message: `Recurring rule ${rule.id} has ${linkedTransactionCount} linked transaction${linkedTransactionCount === 1 ? '' : 's'}. Clear or migrate those links before changing the rule account or type.`,
          }
        }
      }

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldUpdate: {
            ruleId,
            before: {
              id: rule.id,
              description: rule.description,
              amount: fromCentavos(rule.amount),
              amountCentavos: rule.amount,
              type: rule.type,
              frequency: rule.frequency,
              nextDate: rule.next_date,
              endDate: rule.end_date,
              accountId: rule.account_id,
              categoryId: rule.category_id,
              notes: rule.notes,
              active: Boolean(rule.active),
              currency: sourceCurrency,
            },
            after: updatedRule,
          },
          message: `Dry run: recurring rule "${updatedRule.description}" would be updated.`,
        }
      }

      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(ruleId)

      await execute(
        `UPDATE recurring_rules SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )

      return {
        success: true,
        message: `Updated recurring rule "${description ?? rule.description}".`,
      }
    }

    if (action === 'delete') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for delete.' }
      }

      const existing = await query<RecurringRuleRow>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const linkedTransactionCount = await countLinkedRecurringTransactions(ruleId)

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldDelete: {
            id: existing[0].id,
            description: existing[0].description,
            amount: fromCentavos(existing[0].amount),
            type: existing[0].type,
            frequency: existing[0].frequency,
            nextDate: existing[0].next_date,
            active: Boolean(existing[0].active),
            linkedTransactionCount,
          },
          message: `Dry run: recurring rule "${existing[0].description}" would be deleted${linkedTransactionCount > 0 ? ` after unlinking ${linkedTransactionCount} linked transaction${linkedTransactionCount === 1 ? '' : 's'}` : ''}.`,
        }
      }

      transaction(() => {
        execute('UPDATE transactions SET recurring_rule_id = NULL WHERE recurring_rule_id = $1', [
          ruleId,
        ])
        execute('DELETE FROM recurring_rules WHERE id = $1', [ruleId])
      })

      return {
        success: true,
        message: `Deleted recurring rule "${existing[0].description}"${linkedTransactionCount > 0 ? ` and unlinked ${linkedTransactionCount} transaction${linkedTransactionCount === 1 ? '' : 's'}` : ''}.`,
      }
    }

    if (action === 'toggle') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for toggle.' }
      }

      const existing = await query<RecurringRuleRow>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const newActive = existing[0].active ? 0 : 1
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldToggle: {
            id: existing[0].id,
            description: existing[0].description,
            previousActive: Boolean(existing[0].active),
            newActive: Boolean(newActive),
          },
          message: `Dry run: recurring rule "${existing[0].description}" would be ${newActive ? 'activated' : 'paused'}.`,
        }
      }
      await execute(
        "UPDATE recurring_rules SET active = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [newActive, ruleId]
      )

      return {
        success: true,
        message: `${newActive ? 'Activated' : 'Paused'} recurring rule "${existing[0].description}".`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

// ---------------------------------------------------------------------------
// 34. materialize-recurring
// ---------------------------------------------------------------------------
const materializeRecurring: ToolDefinition = {
  name: 'materialize-recurring',
  description:
    'Manually trigger materialization of due recurring transactions. Creates actual transactions for any recurring rules whose next_date has passed.',
  schema: z.object({}),
  execute: async () => {
    const today = dayjs().format('YYYY-MM-DD')

    // Find due recurring rules
    const dueRules = await query<RecurringRuleRow>(
      `SELECT r.*, a.name as account_name, a.currency as account_currency, a.is_archived as account_is_archived
       FROM recurring_rules r
       LEFT JOIN accounts a ON r.account_id = a.id
       WHERE r.active = 1 AND r.next_date <= $1`,
      [today]
    )

    if (dueRules.length === 0) {
      return {
        success: true,
        created: 0,
        message: 'No recurring transactions were due.',
      }
    }

    const unsupportedTransferRule = dueRules.find((rule) => rule.type === 'transfer')
    if (unsupportedTransferRule) {
      return unsupportedRecurringTransferFailure()
    }

    const archivedAccountRule = dueRules.find((rule) => rule.account_is_archived === 1)
    if (archivedAccountRule) {
      return {
        success: false,
        reason: 'account_archived',
        message: `Recurring rule "${archivedAccountRule.description}" points at archived account ${archivedAccountRule.account_id}. Unarchive the account or pause the rule before materializing it.`,
      }
    }

    const unknownCurrencyRule = dueRules.find((rule) => normalizeCurrencyCode(rule.currency) === '')
    if (unknownCurrencyRule) {
      return unknownRecurringRuleCurrencyFailure(unknownCurrencyRule)
    }

    const accountCurrencyMismatchRule = dueRules.find((rule) => {
      const ruleCurrency = normalizeCurrencyCode(rule.currency)
      const accountCurrency = normalizeCurrencyCode(rule.account_currency)
      return ruleCurrency !== '' && (accountCurrency === '' || ruleCurrency !== accountCurrency)
    })
    if (accountCurrencyMismatchRule) {
      return {
        success: false,
        reason: 'rule_account_currency_mismatch',
        message: `Recurring rule "${accountCurrencyMismatchRule.description}" has stored currency ${accountCurrencyMismatchRule.currency} but the linked account is now ${accountCurrencyMismatchRule.account_currency}. Repair or recreate the rule before materializing it.`,
      }
    }

    let created = 0

    for (const rule of dueRules) {
      const createdForRule = transaction(() => {
        let occurrenceDate = rule.next_date
        let createdWithinRule = 0

        while (occurrenceDate <= today) {
          if (rule.end_date && occurrenceDate > rule.end_date) {
            const deactivateResult = execute(
              "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 AND active = 1 AND next_date = $2",
              [rule.id, occurrenceDate]
            )
            if (deactivateResult.rowsAffected !== 1) {
              return createdWithinRule
            }
            return createdWithinRule
          }

          const newNextDate = advanceDate(occurrenceDate, rule.frequency)
          const shouldDeactivate = Boolean(rule.end_date && newNextDate > rule.end_date)
          const claimResult = execute(
            "UPDATE recurring_rules SET active = $1, next_date = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $3 AND active = 1 AND next_date = $4",
            [shouldDeactivate ? 0 : 1, newNextDate, rule.id, occurrenceDate]
          )
          if (claimResult.rowsAffected !== 1) {
            return createdWithinRule
          }

          const txId = generateId()

          execute(
            `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, date, is_recurring, status, recurring_rule_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 'posted', $10)`,
            [
              txId,
              rule.account_id,
              rule.category_id,
              rule.type,
              rule.amount,
              normalizeCurrencyCode(rule.currency),
              rule.description,
              rule.notes,
              occurrenceDate,
              rule.id,
            ]
          )

          const balanceChange = rule.type === 'income' ? rule.amount : -rule.amount
          execute(
            "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
            [balanceChange, rule.account_id]
          )

          createdWithinRule += 1
          occurrenceDate = newNextDate
          if (shouldDeactivate) {
            return createdWithinRule
          }
        }

        return createdWithinRule
      })

      created += createdForRule
    }

    return {
      success: true,
      created,
      message:
        created > 0
          ? `Created ${created} transaction(s) from recurring rules.`
          : 'No recurring transactions were due.',
    }
  },
}

// ---------------------------------------------------------------------------
// 35. get-forecasted-cash-flow
// ---------------------------------------------------------------------------

const getRecurringExpectedVsPaid: ToolDefinition = {
  name: 'get-recurring-expected-vs-paid',
  description:
    'Report expected recurring bills over a date range using the current next_date schedule with paid, unpaid, or late status. Uses recurring_rule_id links first and clearly marks conservative fallback matches.',
  schema: z.object({
    startDate: isoDate('Date range start in YYYY-MM-DD format'),
    endDate: isoDate('Date range end in YYYY-MM-DD format'),
    type: z
      .enum(['expense', 'income'])
      .optional()
      .default('expense')
      .describe('Recurring rule type to report. Defaults to expense bills.'),
    accountId: boundedText('Account ID', 'Optional account ID filter', 128).optional(),
    includeInactive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include inactive recurring rules'),
    fallbackWindowDays: z
      .number()
      .int()
      .min(0)
      .max(14)
      .optional()
      .default(3)
      .describe('Date tolerance for legacy fallback matching'),
    asOfDate: isoDate('Date used to decide whether unpaid occurrences are late').optional(),
  }),
  execute: async ({
    startDate,
    endDate,
    type,
    accountId,
    includeInactive,
    fallbackWindowDays,
    asOfDate,
  }) => {
    if (dayjs(startDate).isAfter(dayjs(endDate), 'day')) {
      return {
        success: false,
        reason: 'invalid_report_range',
        message: 'startDate must be on or before endDate.',
      }
    }

    const filters = ['r.type = $1', 'r.next_date <= $2', '(r.end_date IS NULL OR r.end_date >= $3)']
    const params: unknown[] = [type, endDate, startDate]
    if (!includeInactive) filters.push('r.active = 1')
    if (accountId) {
      filters.push(`r.account_id = $${params.length + 1}`)
      params.push(accountId)
    }

    const rules = query<RecurringExpectedRuleRow>(
      `SELECT r.*, a.name as account_name, a.currency as account_currency, c.name as category_name
       FROM recurring_rules r
       LEFT JOIN accounts a ON r.account_id = a.id
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE ${filters.join(' AND ')}
       ORDER BY r.next_date ASC, r.description ASC`,
      params
    )

    const occurrences = buildRecurringOccurrences(rules, startDate, endDate)
    const extendedStart = dayjs(startDate).subtract(fallbackWindowDays, 'day').format('YYYY-MM-DD')
    const extendedEnd = dayjs(endDate).add(fallbackWindowDays, 'day').format('YYYY-MM-DD')
    const txFilters = ['type = $1', 'date >= $2', 'date <= $3']
    const txParams: unknown[] = [type, extendedStart, extendedEnd]
    if (accountId) {
      txFilters.push(`account_id = $${txParams.length + 1}`)
      txParams.push(accountId)
    }
    const transactions = query<RecurringPaidTransactionRow>(
      `SELECT id, recurring_rule_id, account_id, type, amount, currency, description, date, status
       FROM transactions
       WHERE ${txFilters.join(' AND ')}
       ORDER BY date ASC, id ASC`,
      txParams
    )

    const usedTransactionIds = new Set<string>()
    const expectedTotals = new Map<string, number>()
    const paidTotals = new Map<string, number>()
    const reportAsOfDate = asOfDate ?? dayjs().format('YYYY-MM-DD')

    const expected = occurrences.map((occurrence) => {
      addCurrencyTotal(expectedTotals, occurrence.currency, occurrence.amount)
      const match = findRecurringMatch({
        occurrence,
        transactions,
        usedTransactionIds,
        fallbackWindowDays,
      })
      if (match) usedTransactionIds.add(match.transaction.id)
      const paymentStatus = occurrencePaymentStatus(
        match?.transaction ?? null,
        occurrence.dueDate,
        reportAsOfDate
      )
      if (paymentStatus === 'paid')
        addCurrencyTotal(paidTotals, occurrence.currency, occurrence.amount)

      return {
        ruleId: occurrence.rule.id,
        description: occurrence.rule.description,
        dueDate: occurrence.dueDate,
        amount: fromCentavos(occurrence.amount),
        amountCentavos: occurrence.amount,
        currency: occurrence.currency,
        type: occurrence.rule.type,
        accountId: occurrence.rule.account_id,
        accountName: occurrence.rule.account_name,
        categoryId: occurrence.rule.category_id,
        categoryName: occurrence.rule.category_name,
        frequency: occurrence.rule.frequency,
        status: paymentStatus,
        paid: paymentStatus === 'paid',
        late: paymentStatus === 'late',
        match: match
          ? {
              transactionId: match.transaction.id,
              date: match.transaction.date,
              status: match.transaction.status ?? 'posted',
              method: match.method,
              fallback: match.method === 'fallback_heuristic',
            }
          : null,
        fallbackMatched: match?.method === 'fallback_heuristic',
      }
    })

    const byRule = rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      amount: fromCentavos(rule.amount),
      amountCentavos: rule.amount,
      currency:
        normalizeCurrencyCode(rule.currency) || normalizeCurrencyCode(rule.account_currency),
      type: rule.type,
      frequency: rule.frequency,
      active: Boolean(rule.active),
      accountId: rule.account_id,
      accountName: rule.account_name,
      categoryId: rule.category_id,
      categoryName: rule.category_name,
      expected: expected.filter((item) => item.ruleId === rule.id),
    }))

    const paidCount = expected.filter((item) => item.status === 'paid').length
    const lateCount = expected.filter((item) => item.status === 'late').length
    const unpaidCount = expected.filter((item) => item.status === 'unpaid').length
    const fallbackMatches = expected.filter((item) => item.fallbackMatched).length
    const linkedMatches = expected.filter(
      (item) => item.match?.method === 'recurring_rule_id'
    ).length

    return {
      success: true,
      period: { startDate, endDate, asOfDate: reportAsOfDate },
      scheduleBasis: 'current_next_date',
      scheduleNote:
        'Expected items are generated forward from each rule current next_date; historical linked transactions can match expected items but do not create earlier expected occurrences without a persisted recurrence anchor.',
      fallbackWindowDays,
      rules: byRule,
      expected,
      summary: {
        ruleCount: rules.length,
        expectedCount: expected.length,
        paidCount,
        unpaidCount,
        lateCount,
        linkedMatches,
        fallbackMatches,
        totalsByCurrency: currencyTotalsSnapshot(expectedTotals),
        paidTotalsByCurrency: currencyTotalsSnapshot(paidTotals),
      },
      message:
        expected.length === 0
          ? `No expected recurring ${type} item(s) found from ${startDate} to ${endDate}.`
          : `Found ${expected.length} expected recurring ${type} item(s): ${paidCount} paid, ${unpaidCount} unpaid, ${lateCount} late.`,
    }
  },
}

export const recurringTools: ToolDefinition[] = [
  manageRecurringTransaction,
  materializeRecurring,
  getRecurringExpectedVsPaid,
]
