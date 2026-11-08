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
  positiveMoneyAmount,
  isoDate,
  assetCode,
  isAccountWriteEligible,
  resolveAccountId,
  resolveCategoryId,
  normalizeCurrencyCode,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import { listSubscriptionsSummary, getSubscriptionSpendingSummary } from '../insights.js'
import { assertSingleRowUpdated } from './shared.js'

type SubscriptionRow = {
  id: string
  account_id: string | null
  category_id: string | null
  name: string
  amount: number
  currency: string
  billing_cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  next_billing_date: string
  icon: string | null
  color: string | null
  url: string | null
  notes: string | null
  is_active: number
}

type SubscriptionAccountRow = {
  id: string
  currency: string
  is_archived: number
}

type TransactionSubscriptionSourceRow = {
  id: string
  account_id: string | null
  category_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  date: string
}

function subscriptionSnapshot(subscription: SubscriptionRow) {
  return {
    id: subscription.id,
    accountId: subscription.account_id,
    categoryId: subscription.category_id,
    name: subscription.name,
    amount: fromCentavos(subscription.amount),
    amountCentavos: subscription.amount,
    currency: subscription.currency,
    billingCycle: subscription.billing_cycle,
    nextBillingDate: subscription.next_billing_date,
    icon: subscription.icon,
    color: subscription.color,
    url: subscription.url,
    notes: subscription.notes,
    isActive: subscription.is_active === 1,
  }
}

function getSubscription(subscriptionId: string): SubscriptionRow | null {
  const rows = query<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = $1 LIMIT 1', [
    subscriptionId,
  ]) as SubscriptionRow[] | undefined
  return rows?.[0] ?? null
}

function resolveOptionalSubscriptionAccount(accountId?: string, account?: string) {
  if (!accountId && !account) return { success: true as const, id: null, currency: null }
  return resolveAccountId(accountId, account)
}

function getSubscriptionAccount(accountId: string) {
  const account = query<SubscriptionAccountRow>(
    'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  )[0]
  if (!account) return { success: false as const, message: `Account ${accountId} not found.` }
  if (!isAccountWriteEligible(account)) {
    return {
      success: false as const,
      message: `Account ${accountId} is archived. Unarchive it before using it for new writes.`,
    }
  }
  return { success: true as const, id: account.id, currency: account.currency }
}

function resolveOptionalSubscriptionCategory(categoryId?: string, category?: string) {
  if (categoryId) {
    const rows = query<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE id = $1 LIMIT 1',
      [categoryId]
    )
    if (rows.length === 0) {
      return { success: false as const, message: `Category ${categoryId} not found.` }
    }
    return { success: true as const, id: rows[0].id, name: rows[0].name }
  }
  return resolveCategoryId(category)
}

function subscriptionCurrencyFailure(accountCurrency: string | null, currency: string) {
  if (!accountCurrency) return null
  return normalizeCurrencyCode(accountCurrency) === normalizeCurrencyCode(currency)
    ? null
    : {
        success: false as const,
        reason: 'subscription_currency_mismatch' as const,
        message: `Subscription currency ${currency} does not match linked account currency ${accountCurrency}. Use an account with matching currency or omit the account link.`,
      }
}

function nextSubscriptionDateFromTransactionDate(
  transactionDate: string,
  billingCycle: SubscriptionRow['billing_cycle']
): string {
  const baseDate = dayjs(transactionDate)
  switch (billingCycle) {
    case 'weekly':
      return baseDate.add(1, 'week').format('YYYY-MM-DD')
    case 'quarterly':
      return baseDate.add(3, 'month').format('YYYY-MM-DD')
    case 'yearly':
      return baseDate.add(1, 'year').format('YYYY-MM-DD')
    case 'monthly':
    default:
      return baseDate.add(1, 'month').format('YYYY-MM-DD')
  }
}

function transactionSourceSnapshot(transactionRow: TransactionSubscriptionSourceRow) {
  return {
    id: transactionRow.id,
    accountId: transactionRow.account_id,
    categoryId: transactionRow.category_id,
    type: transactionRow.type,
    amount: fromCentavos(transactionRow.amount),
    amountCentavos: transactionRow.amount,
    currency: transactionRow.currency,
    description: transactionRow.description,
    notes: transactionRow.notes,
    date: transactionRow.date,
  }
}

export const createSubscription: ToolDefinition = {
  name: 'create-subscription',
  description:
    'Create a subscription with optional account/category resolution and a dry-run preview.',
  schema: z.object({
    name: boundedText('Subscription name', 'Subscription name', 160),
    amount: positiveMoneyAmount('Subscription amount in the main currency unit'),
    billingCycle: z
      .enum(['weekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('Billing cycle'),
    nextBillingDate: isoDate('Next billing date in YYYY-MM-DD format'),
    currency: assetCode(
      'Currency or asset code. Defaults to the linked account currency or USD'
    ).optional(),
    accountId: boundedText('Account ID', 'Optional linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional linked account alias, exact account ID, or exact account name',
      128
    ).optional(),
    categoryId: boundedText('Category ID', 'Optional linked category ID', 128).optional(),
    category: boundedText('Category', 'Optional category name to resolve', 120).optional(),
    icon: boundedText('Icon', 'Optional icon name', 80).optional(),
    color: boundedText('Color', 'Optional display color', 80).optional(),
    url: z.string().trim().max(500).optional().describe('Optional subscription URL'),
    notes: z.string().trim().max(1000).optional().describe('Optional notes'),
    active: z.boolean().optional().default(true).describe('Whether the subscription is active'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription without writing it'),
  }),
  execute: async ({
    name,
    amount,
    billingCycle,
    nextBillingDate,
    currency,
    accountId,
    account,
    categoryId,
    category,
    icon,
    color,
    url,
    notes,
    active,
    dryRun,
  }) => {
    const resolvedAccount = resolveOptionalSubscriptionAccount(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount
    const resolvedCategory = resolveOptionalSubscriptionCategory(categoryId, category)
    if (!resolvedCategory.success) return resolvedCategory

    const resolvedCurrency = currency ?? resolvedAccount.currency ?? 'USD'
    const currencyFailure = subscriptionCurrencyFailure(resolvedAccount.currency, resolvedCurrency)
    if (currencyFailure) return currencyFailure

    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const subscription: SubscriptionRow = {
      id,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name,
      amount: amountCentavos,
      currency: resolvedCurrency,
      billing_cycle: billingCycle,
      next_billing_date: nextBillingDate,
      icon: icon ?? null,
      color: color ?? null,
      url: url ?? null,
      notes: notes ?? null,
      is_active: active ? 1 : 0,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreate: subscriptionSnapshot(subscription),
        message: `Dry run: subscription "${name}" would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO subscriptions (id, account_id, category_id, name, amount, currency, billing_cycle, next_billing_date, icon, color, url, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          subscription.account_id,
          subscription.category_id,
          name,
          amountCentavos,
          resolvedCurrency,
          billingCycle,
          nextBillingDate,
          icon ?? null,
          color ?? null,
          url ?? null,
          notes ?? null,
          active ? 1 : 0,
        ]
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: id,
        action: 'create',
        before: null,
        after: { subscription: subscriptionSnapshot(subscription) },
      })
    })

    return {
      success: true,
      action: 'created' as const,
      dryRun: false,
      subscription: subscriptionSnapshot(subscription),
      message: `Created subscription "${name}".`,
    }
  },
}

export const createSubscriptionFromTransaction: ToolDefinition = {
  name: 'create-subscription-from-transaction',
  description:
    'Create a subscription using an existing transaction as the default source for amount, account, category, name, and currency.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Transaction to use as subscription source', 128),
    name: boundedText(
      'Subscription name',
      'Optional subscription name. Defaults to transaction description',
      160
    ).optional(),
    billingCycle: z
      .enum(['weekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('Billing cycle'),
    nextDate: isoDate('Next billing date in YYYY-MM-DD format').optional(),
    nextBillingDate: isoDate('Next billing date in YYYY-MM-DD format').optional(),
    amount: positiveMoneyAmount(
      'Subscription amount override in the main currency unit'
    ).optional(),
    accountId: boundedText('Account ID', 'Optional linked account ID override', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional linked account alias, exact account ID, or exact account name override',
      128
    ).optional(),
    categoryId: boundedText('Category ID', 'Optional linked category ID override', 128).optional(),
    category: boundedText('Category', 'Optional category name override', 120).optional(),
    notes: z.string().trim().max(1000).optional().describe('Optional subscription notes'),
    source: boundedText(
      'Source',
      'Automation source or origin label for audit provenance',
      120
    ).optional(),
    note: boundedText('Note', 'Workflow changelog note for audit provenance', 500).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription without writing it'),
  }),
  execute: async ({
    transactionId,
    name,
    billingCycle,
    nextDate,
    nextBillingDate,
    amount,
    accountId,
    account,
    categoryId,
    category,
    notes,
    source,
    note,
    dryRun,
  }) => {
    if (nextDate && nextBillingDate && nextDate !== nextBillingDate) {
      return {
        success: false,
        reason: 'conflicting_next_billing_date',
        message: 'Use either nextDate or nextBillingDate, not both with different values.',
      }
    }

    const sourceRows = query<TransactionSubscriptionSourceRow>(
      'SELECT id, account_id, category_id, type, amount, currency, description, notes, date FROM transactions WHERE id = $1 LIMIT 1',
      [transactionId]
    )
    if (sourceRows.length === 0) {
      return {
        success: false,
        reason: 'transaction_not_found',
        message: `Transaction ${transactionId} not found.`,
      }
    }

    const sourceTransaction = sourceRows[0]
    if (sourceTransaction.type === 'transfer') {
      return {
        success: false,
        reason: 'subscription_transaction_type_unsupported',
        message: 'Transfer transactions cannot be converted into subscriptions.',
      }
    }
    if (!sourceTransaction.currency) {
      return {
        success: false,
        reason: 'transaction_currency_missing',
        message: `Transaction ${transactionId} has no currency. Repair it before creating a subscription from it.`,
      }
    }

    const resolvedAccount =
      accountId || account
        ? resolveOptionalSubscriptionAccount(accountId, account)
        : sourceTransaction.account_id
          ? getSubscriptionAccount(sourceTransaction.account_id)
          : { success: true as const, id: null, currency: null }
    if (!resolvedAccount.success) return resolvedAccount

    const resolvedCategory =
      categoryId || category
        ? resolveOptionalSubscriptionCategory(categoryId, category)
        : { success: true as const, id: sourceTransaction.category_id, name: null }
    if (!resolvedCategory.success) return resolvedCategory

    const currencyFailure = subscriptionCurrencyFailure(
      resolvedAccount.currency,
      sourceTransaction.currency
    )
    if (currencyFailure) return currencyFailure

    const id = generateId()
    const amountCentavos = amount !== undefined ? toCentavos(amount) : sourceTransaction.amount
    const resolvedNextBillingDate =
      nextDate ??
      nextBillingDate ??
      nextSubscriptionDateFromTransactionDate(sourceTransaction.date, billingCycle)
    const subscription: SubscriptionRow = {
      id,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name: name ?? sourceTransaction.description,
      amount: amountCentavos,
      currency: sourceTransaction.currency,
      billing_cycle: billingCycle,
      next_billing_date: resolvedNextBillingDate,
      icon: null,
      color: null,
      url: null,
      notes: notes ?? sourceTransaction.notes,
      is_active: 1,
    }
    const sourceSnapshot = transactionSourceSnapshot(sourceTransaction)
    const subscriptionOutput = subscriptionSnapshot(subscription)

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreateSubscription: subscriptionOutput,
        wouldLinkTransactionId: transactionId,
        sourceTransaction: sourceSnapshot,
        message: `Dry run: subscription "${subscription.name}" would be created from transaction ${transactionId}.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO subscriptions (id, account_id, category_id, name, amount, currency, billing_cycle, next_billing_date, icon, color, url, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          subscription.account_id,
          subscription.category_id,
          subscription.name,
          subscription.amount,
          subscription.currency,
          subscription.billing_cycle,
          subscription.next_billing_date,
          subscription.icon,
          subscription.color,
          subscription.url,
          subscription.notes,
          subscription.is_active,
        ]
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: id,
        action: 'create-from-transaction',
        before: { transaction: sourceSnapshot },
        after: { subscription: subscriptionOutput, linkedTransactionId: transactionId },
        source: source ?? null,
        note: note ?? null,
      })
    })

    return {
      success: true,
      action: 'created' as const,
      dryRun: false,
      subscription: subscriptionOutput,
      linkedTransactionId: transactionId,
      sourceTransaction: sourceSnapshot,
      message: `Created subscription "${subscription.name}" from transaction ${transactionId}.`,
    }
  },
}

export const updateSubscription: ToolDefinition = {
  name: 'update-subscription',
  description:
    'Update a subscription by ID with optional account/category resolution and a dry-run preview.',
  schema: z.object({
    subscriptionId: boundedText('Subscription ID', 'Subscription ID to update', 128),
    name: boundedText('Subscription name', 'New subscription name', 160).optional(),
    amount: positiveMoneyAmount('New subscription amount in the main currency unit').optional(),
    billingCycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
    nextBillingDate: isoDate('New next billing date in YYYY-MM-DD format').optional(),
    currency: assetCode('New currency or asset code').optional(),
    accountId: boundedText('Account ID', 'New linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'New linked account alias, exact account ID, or exact account name',
      128
    ).optional(),
    clearAccount: z.boolean().optional().default(false).describe('Clear the linked account'),
    categoryId: boundedText('Category ID', 'New linked category ID', 128).optional(),
    category: boundedText('Category', 'New category name to resolve', 120).optional(),
    clearCategory: z.boolean().optional().default(false).describe('Clear the linked category'),
    icon: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .optional()
      .describe('New icon. Pass null, an empty string, or clearIcon to clear.'),
    color: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .optional()
      .describe('New color. Pass null, an empty string, or clearColor to clear.'),
    url: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .describe('New URL. Pass null, an empty string, or clearUrl to clear.'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .describe('New notes. Pass null, an empty string, or clearNotes to clear.'),
    clearIcon: z.boolean().optional().describe('Clear the icon'),
    clearColor: z.boolean().optional().describe('Clear the color'),
    clearUrl: z.boolean().optional().describe('Clear the URL'),
    clearNotes: z.boolean().optional().describe('Clear notes'),
    active: z.boolean().optional().describe('Whether the subscription is active'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription update without writing it'),
  }),
  execute: async ({
    subscriptionId,
    name,
    amount,
    billingCycle,
    nextBillingDate,
    currency,
    accountId,
    account,
    clearAccount,
    categoryId,
    category,
    clearCategory,
    icon,
    color,
    url,
    notes,
    clearIcon,
    clearColor,
    clearUrl,
    clearNotes,
    active,
    dryRun,
  }) => {
    const existing = getSubscription(subscriptionId)
    if (!existing) {
      return {
        success: false,
        reason: 'subscription_not_found',
        message: `Subscription ${subscriptionId} not found.`,
      }
    }

    if (clearAccount && (accountId || account)) {
      return { success: false, message: 'Use either clearAccount or account/accountId, not both.' }
    }
    if (clearCategory && (categoryId || category)) {
      return {
        success: false,
        message: 'Use either clearCategory or category/categoryId, not both.',
      }
    }
    if (clearIcon && icon !== undefined) {
      return { success: false, message: 'Use either clearIcon or icon, not both.' }
    }
    if (clearColor && color !== undefined) {
      return { success: false, message: 'Use either clearColor or color, not both.' }
    }
    if (clearUrl && url !== undefined) {
      return { success: false, message: 'Use either clearUrl or url, not both.' }
    }
    if (clearNotes && notes !== undefined) {
      return { success: false, message: 'Use either clearNotes or notes, not both.' }
    }

    const resolvedAccount = clearAccount
      ? { success: true as const, id: null, currency: null }
      : accountId || account
        ? resolveOptionalSubscriptionAccount(accountId, account)
        : existing.account_id
          ? getSubscriptionAccount(existing.account_id)
          : { success: true as const, id: null, currency: null }
    if (!resolvedAccount.success) return resolvedAccount

    const resolvedCategory = clearCategory
      ? { success: true as const, id: null, name: null }
      : categoryId || category
        ? resolveOptionalSubscriptionCategory(categoryId, category)
        : { success: true as const, id: existing.category_id, name: null }
    if (!resolvedCategory.success) return resolvedCategory

    const nextCurrency = currency ?? existing.currency
    const accountCurrency = resolvedAccount.currency
    const currencyFailure = subscriptionCurrencyFailure(accountCurrency, nextCurrency)
    if (currencyFailure) return currencyFailure

    const updated: SubscriptionRow = {
      ...existing,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name: name ?? existing.name,
      amount: amount !== undefined ? toCentavos(amount) : existing.amount,
      currency: nextCurrency,
      billing_cycle: billingCycle ?? existing.billing_cycle,
      next_billing_date: nextBillingDate ?? existing.next_billing_date,
      icon: clearIcon
        ? null
        : icon !== undefined
          ? icon === '' || icon === null
            ? null
            : icon
          : existing.icon,
      color: clearColor
        ? null
        : color !== undefined
          ? color === '' || color === null
            ? null
            : color
          : existing.color,
      url: clearUrl
        ? null
        : url !== undefined
          ? url === '' || url === null
            ? null
            : url
          : existing.url,
      notes: clearNotes
        ? null
        : notes !== undefined
          ? notes === '' || notes === null
            ? null
            : notes
          : existing.notes,
      is_active: active !== undefined ? (active ? 1 : 0) : existing.is_active,
    }

    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`)
      params.push(value)
    }

    if (updated.account_id !== existing.account_id) addSet('account_id', updated.account_id)
    if (updated.category_id !== existing.category_id) addSet('category_id', updated.category_id)
    if (updated.name !== existing.name) addSet('name', updated.name)
    if (updated.amount !== existing.amount) addSet('amount', updated.amount)
    if (normalizeCurrencyCode(updated.currency) !== normalizeCurrencyCode(existing.currency)) {
      addSet('currency', updated.currency)
    }
    if (updated.billing_cycle !== existing.billing_cycle)
      addSet('billing_cycle', updated.billing_cycle)
    if (updated.next_billing_date !== existing.next_billing_date) {
      addSet('next_billing_date', updated.next_billing_date)
    }
    if (updated.icon !== existing.icon) addSet('icon', updated.icon)
    if (updated.color !== existing.color) addSet('color', updated.color)
    if (updated.url !== existing.url) addSet('url', updated.url)
    if (updated.notes !== existing.notes) addSet('notes', updated.notes)
    if (updated.is_active !== existing.is_active) addSet('is_active', updated.is_active)

    if (setClauses.length === 0) {
      return {
        success: true,
        action: 'updated' as const,
        ...(dryRun ? { dryRun: true } : {}),
        changed: false,
        subscription: subscriptionSnapshot(existing),
        message: dryRun
          ? `Dry run: subscription "${existing.name}" already matches the requested values.`
          : `Subscription "${existing.name}" already matches the requested values.`,
      }
    }

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        changed: true,
        wouldUpdate: {
          subscriptionId,
          before: subscriptionSnapshot(existing),
          after: subscriptionSnapshot(updated),
        },
        message: `Dry run: subscription "${updated.name}" would be updated.`,
      }
    }

    transaction(() => {
      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(subscriptionId)
      const updateResult = execute(
        `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )
      assertSingleRowUpdated(
        updateResult,
        `Subscription ${subscriptionId} could not be updated safely.`
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: subscriptionId,
        action: 'update',
        before: { subscription: subscriptionSnapshot(existing) },
        after: { subscription: subscriptionSnapshot(updated) },
      })
    })

    return {
      success: true,
      action: 'updated' as const,
      changed: true,
      subscription: subscriptionSnapshot(updated),
      message: `Updated subscription "${updated.name}".`,
    }
  },
}

export const deleteSubscription: ToolDefinition = {
  name: 'delete-subscription',
  description: 'Delete a subscription by ID with a dry-run preview.',
  schema: z.object({
    subscriptionId: boundedText('Subscription ID', 'Subscription ID to delete', 128),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription deletion without writing it'),
  }),
  execute: async ({ subscriptionId, dryRun }) => {
    const existing = getSubscription(subscriptionId)
    if (!existing) {
      return {
        success: false,
        reason: 'subscription_not_found',
        message: `Subscription ${subscriptionId} not found.`,
      }
    }

    if (dryRun) {
      return {
        success: true,
        action: 'deleted' as const,
        dryRun: true,
        wouldDelete: subscriptionSnapshot(existing),
        message: `Dry run: subscription "${existing.name}" would be deleted.`,
      }
    }

    transaction(() => {
      execute('DELETE FROM subscriptions WHERE id = $1', [subscriptionId])
      writeAuditLog({
        entity: 'subscription',
        entityId: subscriptionId,
        action: 'delete',
        before: { subscription: subscriptionSnapshot(existing) },
        after: null,
      })
    })

    return {
      success: true,
      action: 'deleted' as const,
      subscription: subscriptionSnapshot(existing),
      message: `Deleted subscription "${existing.name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 23. list-subscriptions
// ---------------------------------------------------------------------------
export const listSubscriptions: ToolDefinition = {
  name: 'list-subscriptions',
  description:
    'List subscriptions stored in Shikin. Shows amounts, billing cycles, next payment dates, and monthly/yearly cost equivalents.',
  schema: z.object({
    activeOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe('Only show active subscriptions (default: true)'),
  }),
  execute: async ({ activeOnly }) => listSubscriptionsSummary(activeOnly),
}

// ---------------------------------------------------------------------------
// 24. get-subscription-spending
// ---------------------------------------------------------------------------
export const getSubscriptionSpending: ToolDefinition = {
  name: 'get-subscription-spending',
  description:
    'Analyze subscription spending from Shikin data. Groups active subscriptions by category and billing cycle with monthly/yearly totals.',
  schema: z.object({}),
  execute: async () => getSubscriptionSpendingSummary(),
}
