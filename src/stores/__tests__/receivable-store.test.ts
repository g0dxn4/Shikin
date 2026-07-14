import { describe, it, expect, vi, beforeEach } from 'vitest'
import dayjs from 'dayjs'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(
    async (
      callback: (client: {
        query: <T>(sql: string, bindValues?: unknown[]) => Promise<T[]>
        execute: (
          sql: string,
          bindValues?: unknown[]
        ) => Promise<{ rowsAffected: number; lastInsertId: number }>
      }) => Promise<unknown>
    ) => {
      const database = await import('@/lib/database')
      return callback({ query: database.query, execute: database.execute })
    }
  ),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTRECV00000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { useReceivableStore } from '../receivable-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

function makeReceivableRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '01RECV001',
    payer: 'Acme Corp',
    amount: 500000,
    received_amount: 200000,
    currency: 'USD',
    due_date: dayjs().add(30, 'day').format('YYYY-MM-DD'),
    project_reference: 'Website',
    invoice_reference: 'INV-001',
    status: 'partial',
    account_id: '01ACC001',
    matched_transaction_id: null,
    notes: null,
    source: null,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    account_name: 'Checking',
    account_currency: 'USD',
    ...overrides,
  }
}

describe('receivable-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReceivableStore.setState({
      receivables: [],
      isLoading: false,
      fetchError: null,
      error: null,
    })
  })

  describe('fetch', () => {
    it('loads receivables from database with derived fields', async () => {
      const pastDate = dayjs().subtract(5, 'day').format('YYYY-MM-DD')
      const futureDate = dayjs().add(30, 'day').format('YYYY-MM-DD')

      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({
          id: '01RECV001',
          due_date: pastDate,
          status: 'partial',
          amount: 500000,
          received_amount: 200000,
        }),
        makeReceivableRow({
          id: '01RECV002',
          payer: 'Globex',
          due_date: futureDate,
          status: 'open',
          amount: 100000,
          received_amount: 0,
          account_id: null,
          account_name: null,
          account_currency: null,
        }),
      ])

      await useReceivableStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN accounts'))
      const receivables = useReceivableStore.getState().receivables
      expect(receivables).toHaveLength(2)

      expect(receivables[0].accountName).toBe('Checking')
      expect(receivables[0].isOverdue).toBe(true)
      expect(receivables[0].remainingAmount).toBe(300000)

      expect(receivables[1].accountName).toBeNull()
      expect(receivables[1].isOverdue).toBe(false)
      expect(receivables[1].remainingAmount).toBe(100000)
    })

    it('sets isLoading during fetch', async () => {
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
      )

      const promise = useReceivableStore.getState().fetch()
      expect(useReceivableStore.getState().isLoading).toBe(true)
      await promise
      expect(useReceivableStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error and sets fetchError', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await expect(useReceivableStore.getState().fetch()).rejects.toThrow('DB error')
      expect(useReceivableStore.getState().isLoading).toBe(false)
      expect(useReceivableStore.getState().fetchError).toBe('DB error')
      expect(useReceivableStore.getState().error).toBeNull()
    })

    it('marks received and cancelled receivables as not overdue even with past due dates', async () => {
      const pastDate = dayjs().subtract(5, 'day').format('YYYY-MM-DD')
      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({
          id: '01RECV003',
          payer: 'Received Co',
          due_date: pastDate,
          status: 'received',
          amount: 100000,
          received_amount: 100000,
          account_id: null,
          account_name: null,
          account_currency: null,
        }),
        makeReceivableRow({
          id: '01RECV004',
          payer: 'Cancelled Co',
          due_date: pastDate,
          status: 'cancelled',
          amount: 100000,
          received_amount: 0,
          account_id: null,
          account_name: null,
          account_currency: null,
        }),
      ])

      await useReceivableStore.getState().fetch()
      const receivables = useReceivableStore.getState().receivables
      expect(receivables[0].isOverdue).toBe(false)
      expect(receivables[1].isOverdue).toBe(false)
    })

    it('clamps remaining amount to zero when received exceeds amount', async () => {
      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({
          id: '01RECV005',
          amount: 100000,
          received_amount: 150000,
          status: 'received',
        }),
      ])

      await useReceivableStore.getState().fetch()
      expect(useReceivableStore.getState().receivables[0].remainingAmount).toBe(0)
    })
  })

  describe('create', () => {
    it('generates ULID, converts amount to centavos, and creates an open receivable', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useReceivableStore.getState().create({
        payer: 'Acme Corp',
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-12-31',
        projectReference: 'Website',
        invoiceReference: 'INV-001',
        accountId: null,
        notes: 'For website work',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO receivables'),
        expect.arrayContaining([
          '01TESTRECV00000000000000000',
          'Acme Corp',
          100000,
          'USD',
          '2026-12-31',
          'Website',
          'INV-001',
          'For website work',
        ])
      )
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('creates an unlinked receivable without an account lookup', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useReceivableStore.getState().create({
        payer: 'New Client',
        amount: 500,
        currency: 'USD',
        dueDate: '2026-12-31',
        projectReference: null,
        invoiceReference: null,
        accountId: null,
        notes: null,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'open'"),
        expect.any(Array)
      )
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('update', () => {
    it('updates an existing receivable and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({ status: 'open', received_amount: 0, account_id: null }),
      ])
      mockQuery.mockResolvedValueOnce([])

      await useReceivableStore.getState().update('01RECV001', {
        payer: 'Updated Corp',
        amount: 5000,
        currency: 'USD',
        dueDate: '2027-01-01',
        projectReference: 'Updated Project',
        invoiceReference: 'INV-002',
        accountId: null,
        notes: 'Updated notes',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE receivables'),
        expect.arrayContaining([
          'Updated Corp',
          500000,
          'USD',
          '2027-01-01',
          'Updated Project',
          'INV-002',
          'open',
          'Updated notes',
          expect.any(String),
          '01RECV001',
        ])
      )
    })
  })

  describe('cancel', () => {
    it('sets status to cancelled and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({ status: 'open', received_amount: 0, account_id: null }),
      ])
      mockQuery.mockResolvedValueOnce([])

      await useReceivableStore.getState().cancel('01RECV001')

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'cancelled'"),
        expect.arrayContaining([expect.any(String), '01RECV001'])
      )
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })
  })

  describe('remove', () => {
    it('deletes a receivable and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([
        makeReceivableRow({ status: 'open', received_amount: 0, account_id: null }),
      ])
      mockQuery.mockResolvedValueOnce([])

      await useReceivableStore.getState().remove('01RECV001')

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM receivables'),
        expect.arrayContaining(['01RECV001', 'open'])
      )
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })
  })

  describe('getById', () => {
    it('returns receivable by id', () => {
      const receivable = {
        id: '01RECV001',
        payer: 'Test',
        amount: 100000,
        received_amount: 50000,
        currency: 'USD',
        due_date: '2026-12-31',
        project_reference: null,
        invoice_reference: null,
        status: 'partial' as const,
        account_id: null,
        matched_transaction_id: null,
        notes: null,
        source: null,
        note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        accountName: null,
        accountCurrency: null,
        isOverdue: false,
        remainingAmount: 50000,
      }
      useReceivableStore.setState({ receivables: [receivable] })

      expect(useReceivableStore.getState().getById('01RECV001')).toEqual(receivable)
      expect(useReceivableStore.getState().getById('nonexistent')).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('sets error on create failure and rethrows', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(
        useReceivableStore.getState().create({
          payer: 'Test',
          amount: 100,
          currency: 'USD',
          dueDate: '2026-12-31',
          projectReference: null,
          invoiceReference: null,
          accountId: null,
          notes: null,
        })
      ).rejects.toThrow('Insert failed')

      expect(useReceivableStore.getState().error).toBe('Insert failed')
    })

    it('does not fail mutation when refresh after write fails', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockRejectedValueOnce(new Error('Refresh failed'))

      await useReceivableStore.getState().create({
        payer: 'Test',
        amount: 100,
        currency: 'USD',
        dueDate: '2026-12-31',
        projectReference: null,
        invoiceReference: null,
        accountId: null,
        notes: null,
      })

      expect(useReceivableStore.getState().error).toBeNull()
    })
  })
})
