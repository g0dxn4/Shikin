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
  unsupportedTransferMessage,
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
        return {
          success: false,
          message: unsupportedTransferMessage(),
        }
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
          return {
            success: false,
            message: unsupportedTransferMessage(),
          }
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

      await execute('DELETE FROM recurring_rules WHERE id = $1', [ruleId])

      return {
        success: true,
        message: `Deleted recurring rule "${existing[0].description}".`,
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
      `SELECT r.*, a.name as account_name, a.currency as account_currency
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
            `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, date, is_recurring)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
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

export const recurringTools: ToolDefinition[] = [manageRecurringTransaction, materializeRecurring]
