import { describe, expect, it } from 'vitest'
import type { TransactionPageRow } from '@/lib/transaction-query'
import {
  canDeleteTransaction,
  isTransactionMetadataOnly,
  transactionProtection,
  transactionReviewProtection,
} from '../transaction-inspection-eligibility'

const transaction: TransactionPageRow = {
  id: 'tx-1',
  account_id: 'account-1',
  category_id: null,
  subcategory_id: null,
  type: 'expense',
  amount: 1234,
  currency: 'USD',
  description: 'Coffee',
  notes: null,
  date: '2026-03-01',
  tags: '[]',
  is_recurring: 0,
  transfer_to_account_id: null,
  status: 'posted',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  has_splits: 0,
}

// These operation differences are also pinned through the page and real edit dialog.
const cases: {
  name: string
  patch: Partial<TransactionPageRow>
  protection: string | null
  review: string | null
  metadataOnly: boolean
  remove: boolean
}[] = [
  {
    name: 'ordinary',
    patch: {},
    protection: null,
    review: null,
    metadataOnly: false,
    remove: true,
  },
  {
    name: 'archived',
    patch: { is_archived: 1 },
    protection: 'dialog.archived',
    review: null,
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'matched',
    patch: { matched_transaction_id: 'linked' },
    protection: 'review.protected.linked',
    review: 'review.protected.linked',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'receivable',
    patch: { is_receivable_payment: 1 },
    protection: 'review.protected.receivable',
    review: 'review.protected.receivable',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'reconciliation',
    patch: { is_reconciliation_adjustment: 1 },
    protection: 'review.protected.reconciliation',
    review: 'review.protected.reconciliation',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'workflow',
    patch: { transaction_kind: 'reconciliation_bridge' },
    protection: 'review.protected.workflow',
    review: 'review.protected.workflow',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'unresolved placeholder',
    patch: { is_placeholder: 1, placeholder_status: 'unresolved' },
    protection: null,
    review: null,
    metadataOnly: false,
    remove: true,
  },
  {
    name: 'placeholder with missing status',
    patch: { is_placeholder: 1, placeholder_status: null },
    protection: null,
    review: null,
    metadataOnly: false,
    remove: true,
  },
  {
    name: 'resolved placeholder',
    patch: { is_placeholder: 1, placeholder_status: 'resolved' },
    protection: 'review.protected.placeholderLifecycle',
    review: 'review.protected.placeholderLifecycle',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'lifecycle without placeholder flag',
    patch: { is_placeholder: 0, placeholder_status: 'resolved' },
    protection: null,
    review: null,
    metadataOnly: false,
    remove: true,
  },
  {
    name: 'finalized projection',
    patch: { is_finalized_statement: 1 },
    protection: null,
    review: 'review.protected.finalized',
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'finalization ID without projection',
    patch: { finalization_id: 'final' },
    protection: null,
    review: null,
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'split',
    patch: { has_splits: 1 },
    protection: null,
    review: 'review.protected.split',
    metadataOnly: true,
    remove: true,
  },
  {
    name: 'transfer',
    patch: { type: 'transfer', transfer_to_account_id: 'other' },
    protection: null,
    review: 'review.protected.transfer',
    metadataOnly: false,
    remove: true,
  },
  {
    name: 'all protections competing',
    patch: {
      is_archived: 1,
      has_splits: 1,
      is_receivable_payment: 1,
      is_reconciliation_adjustment: 1,
      is_finalized_statement: 1,
      finalization_id: 'final',
      matched_transaction_id: 'linked',
      transaction_kind: 'archived_transfer_mirror',
      is_placeholder: 1,
      placeholder_status: 'cancelled',
      type: 'transfer',
    },
    protection: 'dialog.archived',
    review: 'review.protected.split',
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'receivable before reconciliation, finalization and match',
    patch: {
      is_receivable_payment: 1,
      is_reconciliation_adjustment: 1,
      is_finalized_statement: 1,
      matched_transaction_id: 'linked',
    },
    protection: 'review.protected.receivable',
    review: 'review.protected.receivable',
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'reconciliation before finalization and match',
    patch: {
      is_reconciliation_adjustment: 1,
      is_finalized_statement: 1,
      matched_transaction_id: 'linked',
    },
    protection: 'review.protected.reconciliation',
    review: 'review.protected.reconciliation',
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'finalization before match only in inline review',
    patch: { is_finalized_statement: 1, matched_transaction_id: 'linked' },
    protection: 'review.protected.linked',
    review: 'review.protected.finalized',
    metadataOnly: true,
    remove: false,
  },
  {
    name: 'match before workflow',
    patch: { matched_transaction_id: 'linked', transaction_kind: 'reconciliation_bridge' },
    protection: 'review.protected.linked',
    review: 'review.protected.linked',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'workflow before completed placeholder',
    patch: {
      transaction_kind: 'reconciliation_bridge',
      is_placeholder: 1,
      placeholder_status: 'split',
    },
    protection: 'review.protected.workflow',
    review: 'review.protected.workflow',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'completed placeholder before transfer',
    patch: { is_placeholder: 1, placeholder_status: 'cancelled', type: 'transfer' },
    protection: 'review.protected.placeholderLifecycle',
    review: 'review.protected.placeholderLifecycle',
    metadataOnly: false,
    remove: false,
  },
  {
    name: 'split finalized transfer',
    patch: { has_splits: 1, is_finalized_statement: 1, finalization_id: 'final', type: 'transfer' },
    protection: null,
    review: 'review.protected.split',
    metadataOnly: true,
    remove: false,
  },
]

describe('transaction UI eligibility', () => {
  it.each(cases)('preserves full-edit protection for $name', ({ patch, protection }) => {
    expect(transactionProtection({ ...transaction, ...patch })).toBe(protection)
  })

  it.each(cases)('preserves inline-review protection for $name', ({ patch, review }) => {
    expect(transactionReviewProtection({ ...transaction, ...patch })).toBe(review)
  })

  it.each(cases)('preserves financial field locks for $name', ({ patch, metadataOnly }) => {
    expect(isTransactionMetadataOnly({ ...transaction, ...patch })).toBe(metadataOnly)
  })

  it.each(cases)('preserves deletion availability for $name', ({ patch, remove }) => {
    expect(canDeleteTransaction({ ...transaction, ...patch })).toBe(remove)
  })
})
