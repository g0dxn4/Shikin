import type { ScopedSnapshot } from '@/lib/scoped-report-read'
import { projectBudget } from '@/lib/scoped-report-read'
export function scopedFixture(): ScopedSnapshot {
  const accounts = [
    {
      id: 'bank',
      name: 'Bank',
      type: 'checking',
      currency: 'MXN',
      account_mode: 'transactional',
      is_archived: 0,
    },
  ]
  const categories = [
    { id: 'food', name: 'Food', color: null },
    { id: 'other', name: 'Other', color: null },
  ]
  return {
    accounts,
    categories,
    mainCurrency: 'MXN',
    budgets: [
      {
        id: 'budget',
        name: 'Food plan',
        category_id: 'food',
        amount: 100000,
        currency: 'MXN',
        period: 'monthly',
        is_active: 1,
        scope_json: '{}',
        basis: 'gross_cashflow',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    dataset: {
      accounts,
      categories,
      transactions: [
        {
          id: 'expense',
          type: 'expense',
          account_id: 'bank',
          category_id: 'food',
          amount: 25000,
          currency: 'MXN',
          date: '2026-01-10',
          status: 'posted',
          tags: '["business"]',
        },
      ],
      splits: [],
      classifications: [],
      typeRevisions: [],
      coverage: [],
      rates: [],
      activePaymentLinks: [],
    },
    estimates: { accounts, categories, rates: [], recurringRules: [], subscriptions: [] },
  }
}
export const fixtureWindow = { asOf: '2026-01-20', timeZone: 'UTC' }
export function fixtureBudget() {
  const snapshot = scopedFixture()
  return projectBudget(snapshot, snapshot.budgets[0], fixtureWindow)
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
