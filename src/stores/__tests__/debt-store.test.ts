import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCalculatePayoffPlan, mockCompareStrategies } = vi.hoisted(() => ({
  mockCalculatePayoffPlan: vi.fn(),
  mockCompareStrategies: vi.fn(),
}))

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTDEBT0000000000000000'),
}))

vi.mock('@/lib/debt-service', () => ({
  calculatePayoffPlan: mockCalculatePayoffPlan,
  compareStrategies: mockCompareStrategies,
}))

import { query } from '@/lib/database'
import { useDebtStore } from '../debt-store'

const mockQuery = vi.mocked(query)

const mockPayoffPlan = {
  strategy: 'avalanche' as const,
  months: 24,
  totalInterestPaid: 50000,
  totalPaid: 250000,
  schedule: [],
  debtPayoffOrder: [],
}

const mockComparison = {
  snowball: { ...mockPayoffPlan, strategy: 'snowball' as const, months: 26, totalInterestPaid: 60000 },
  avalanche: mockPayoffPlan,
  interestSaved: 10000,
  monthsDifference: 2,
}

describe('debt-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCalculatePayoffPlan.mockReturnValue(mockPayoffPlan)
    mockCompareStrategies.mockReturnValue(mockComparison)
    useDebtStore.setState({
      debts: [],
      manualDebts: [],
      strategy: 'avalanche',
      extraPayment: 0,
      isLoading: false,
      payoffPlan: null,
      comparison: null,
      totalDebt: 0,
      totalMinPayment: 0,
    })
  })

  describe('loadDebts', () => {
    it('pulls credit card accounts with negative balances', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01ACC001',
          name: 'Chase Visa',
          type: 'credit_card',
          balance: -150000, // -$1500
          currency: 'USD',
          is_archived: 0,
          created_at: '',
          updated_at: '',
        },
      ])

      await useDebtStore.getState().loadDebts()

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("type = 'credit_card'")
      )
      const state = useDebtStore.getState()
      expect(state.debts).toHaveLength(1)
      expect(state.debts[0].name).toBe('Chase Visa')
      expect(state.debts[0].balance).toBe(150000) // Absolute value
      expect(state.debts[0].minPayment).toBe(3000) // 2% of 150000
    })

    it('uses $25 minimum payment floor', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01ACC002',
          name: 'Small Card',
          type: 'credit_card',
          balance: -5000, // -$50
          currency: 'USD',
          is_archived: 0,
          created_at: '',
          updated_at: '',
        },
      ])

      await useDebtStore.getState().loadDebts()

      // 2% of 5000 = 100, but $25 min = 2500 centavos
      expect(useDebtStore.getState().debts[0].minPayment).toBe(2500)
    })

    it('recalculates payoff plan after loading', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01ACC001',
          name: 'Card',
          type: 'credit_card',
          balance: -100000,
          currency: 'USD',
          is_archived: 0,
          created_at: '',
          updated_at: '',
        },
      ])

      await useDebtStore.getState().loadDebts()

      expect(mockCalculatePayoffPlan).toHaveBeenCalled()
      expect(mockCompareStrategies).toHaveBeenCalled()
      expect(useDebtStore.getState().payoffPlan).toEqual(mockPayoffPlan)
    })

    it('handles empty result gracefully', async () => {
      mockQuery.mockResolvedValueOnce([])

      await useDebtStore.getState().loadDebts()

      expect(useDebtStore.getState().debts).toEqual([])
      expect(useDebtStore.getState().totalDebt).toBe(0)
      expect(useDebtStore.getState().payoffPlan).toBeNull()
    })

    it('handles errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await useDebtStore.getState().loadDebts()

      expect(useDebtStore.getState().isLoading).toBe(false)
    })
  })

  describe('addManualDebt', () => {
    it('adds debt with generated ID and recalculates', () => {
      useDebtStore.getState().addManualDebt({
        name: 'Student Loan',
        balance: 2000000,
        apr: 6.5,
        minPayment: 25000,
      })

      const state = useDebtStore.getState()
      expect(state.manualDebts).toHaveLength(1)
      expect(state.manualDebts[0].id).toBe('01TESTDEBT0000000000000000')
      expect(state.manualDebts[0].name).toBe('Student Loan')
      expect(mockCalculatePayoffPlan).toHaveBeenCalled()
    })
  })

  describe('removeDebt', () => {
    it('removes manual debt by id and recalculates', () => {
      useDebtStore.setState({
        manualDebts: [
          { id: 'debt1', name: 'Loan A', balance: 100000, apr: 5, minPayment: 5000 },
          { id: 'debt2', name: 'Loan B', balance: 200000, apr: 7, minPayment: 10000 },
        ],
      })

      useDebtStore.getState().removeDebt('debt1')

      expect(useDebtStore.getState().manualDebts).toHaveLength(1)
      expect(useDebtStore.getState().manualDebts[0].id).toBe('debt2')
      expect(mockCalculatePayoffPlan).toHaveBeenCalled()
    })
  })

  describe('setStrategy', () => {
    it('switches strategy and recalculates plan', () => {
      // Need debts present for recalculate to call the service
      useDebtStore.setState({
        debts: [{ id: 'd1', name: 'Card', balance: 100000, apr: 20, minPayment: 5000 }],
      })

      useDebtStore.getState().setStrategy('snowball')

      expect(useDebtStore.getState().strategy).toBe('snowball')
      expect(mockCalculatePayoffPlan).toHaveBeenCalled()
    })

    it('sets null plan when no debts', () => {
      useDebtStore.getState().setStrategy('snowball')

      expect(useDebtStore.getState().strategy).toBe('snowball')
      expect(useDebtStore.getState().payoffPlan).toBeNull()
    })
  })

  describe('setExtraPayment', () => {
    it('updates extra payment and recalculates plan', () => {
      useDebtStore.setState({
        debts: [{ id: 'd1', name: 'Card', balance: 100000, apr: 20, minPayment: 5000 }],
      })

      useDebtStore.getState().setExtraPayment(50000)

      expect(useDebtStore.getState().extraPayment).toBe(50000)
      expect(mockCalculatePayoffPlan).toHaveBeenCalled()
    })
  })
})
