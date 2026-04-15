import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTGOAL00000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { useGoalStore } from '../goal-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('goal-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGoalStore.setState({ goals: [], isLoading: false, fetchError: null, error: null })
  })

  describe('fetch', () => {
    it('loads goals from database with progress calculations', async () => {
      const mockGoals = [
        {
          id: '01GOAL001',
          name: 'Vacation Fund',
          target_amount: 200000, // $2000
          current_amount: 100000, // $1000
          deadline: '2027-06-01',
          account_id: '01ACC001',
          icon: 'plane',
          color: '#3b82f6',
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_name: 'Savings',
        },
      ]
      mockQuery.mockResolvedValueOnce(mockGoals)

      await useGoalStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN accounts'))
      const goals = useGoalStore.getState().goals
      expect(goals).toHaveLength(1)
      expect(goals[0].accountName).toBe('Savings')
      expect(goals[0].progress).toBe(50) // 100000/200000 = 50%
      expect(goals[0].daysRemaining).toBeGreaterThan(0)
      expect(goals[0].monthlyNeeded).toBeGreaterThan(0)
    })

    it('sets isLoading during fetch', async () => {
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
      )

      const promise = useGoalStore.getState().fetch()
      expect(useGoalStore.getState().isLoading).toBe(true)
      await promise
      expect(useGoalStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await expect(useGoalStore.getState().fetch()).rejects.toThrow('DB error')
      expect(useGoalStore.getState().isLoading).toBe(false)
      expect(useGoalStore.getState().fetchError).toBe('DB error')
      expect(useGoalStore.getState().error).toBeNull()
    })

    it('computes 100% progress when current >= target', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01GOAL002',
          name: 'Done Goal',
          target_amount: 50000,
          current_amount: 60000,
          deadline: null,
          account_id: null,
          icon: 'star',
          color: '#22c55e',
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_name: null,
        },
      ])

      await useGoalStore.getState().fetch()
      const goals = useGoalStore.getState().goals
      expect(goals[0].progress).toBe(100)
      expect(goals[0].daysRemaining).toBeNull()
      expect(goals[0].monthlyNeeded).toBe(0)
    })
  })

  describe('add', () => {
    it('generates ULID, converts amounts to centavos, and inserts', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useGoalStore.getState().add({
        name: 'Emergency Fund',
        targetAmount: 1000, // $1000
        currentAmount: 250, // $250
        deadline: '2026-12-31',
        accountId: '01ACC001',
        icon: 'shield',
        color: '#ef4444',
        notes: 'For emergencies',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO goals'),
        expect.arrayContaining([
          '01TESTGOAL00000000000000000',
          'Emergency Fund',
          100000, // toCentavos(1000)
          25000, // toCentavos(250)
          '2026-12-31',
          '01ACC001',
          'shield',
          '#ef4444',
          'For emergencies',
        ])
      )
      // Should re-fetch after insert
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('update', () => {
    it('updates an existing goal and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useGoalStore.getState().update('01GOAL001', {
        name: 'Updated Goal',
        targetAmount: 5000,
        currentAmount: 2000,
        deadline: '2027-01-01',
        accountId: null,
        icon: 'target',
        color: '#8b5cf6',
        notes: null,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE goals SET'),
        expect.arrayContaining([
          'Updated Goal',
          500000, // toCentavos(5000)
          200000, // toCentavos(2000)
          '2027-01-01',
          null,
          'target',
          '#8b5cf6',
          null,
          expect.any(String), // updated_at
          '01GOAL001',
        ])
      )
    })
  })

  describe('remove', () => {
    it('deletes a goal and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useGoalStore.getState().remove('01GOAL001')

      expect(mockExecute).toHaveBeenCalledWith('DELETE FROM goals WHERE id = ?', ['01GOAL001'])
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('getById', () => {
    it('returns goal by id', () => {
      const goal = {
        id: '01GOAL001',
        name: 'Test',
        target_amount: 100000,
        current_amount: 50000,
        deadline: null,
        account_id: null,
        icon: 'star',
        color: '#fff',
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        accountName: null,
        progress: 50,
        daysRemaining: null,
        monthlyNeeded: 0,
      }
      useGoalStore.setState({ goals: [goal] })

      expect(useGoalStore.getState().getById('01GOAL001')).toEqual(goal)
      expect(useGoalStore.getState().getById('nonexistent')).toBeUndefined()
    })
  })

  describe('progress calculations', () => {
    it('handles zero target amount gracefully', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01GOAL003',
          name: 'Zero Target',
          target_amount: 0,
          current_amount: 0,
          deadline: null,
          account_id: null,
          icon: 'x',
          color: '#000',
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_name: null,
        },
      ])

      await useGoalStore.getState().fetch()
      expect(useGoalStore.getState().goals[0].progress).toBe(0)
    })

    it('calculates monthlyNeeded for goals with deadlines', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01GOAL004',
          name: 'Near Deadline',
          target_amount: 100000,
          current_amount: 0,
          deadline: '2026-01-01', // Past deadline
          account_id: null,
          icon: 'clock',
          color: '#f00',
          notes: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          account_name: null,
        },
      ])

      await useGoalStore.getState().fetch()
      const goal = useGoalStore.getState().goals[0]
      // Past deadline: daysRemaining should be 0, monthlyNeeded should be the full remaining amount
      expect(goal.daysRemaining).toBe(0)
      expect(goal.monthlyNeeded).toBe(100000) // remaining amount when months <= 0
    })
  })
})
