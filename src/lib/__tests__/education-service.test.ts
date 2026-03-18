import { describe, it, expect } from 'vitest'
import {
  getDailyTip,
  getTipsByTopic,
  getTipForAction,
  getContextualTip,
  getAllTips,
} from '../education-service'
import type { EducationTip } from '../education-service'

function validateTip(tip: EducationTip) {
  expect(tip).toHaveProperty('id')
  expect(tip).toHaveProperty('topic')
  expect(tip).toHaveProperty('title')
  expect(tip).toHaveProperty('content')
  expect(typeof tip.id).toBe('string')
  expect(typeof tip.topic).toBe('string')
  expect(typeof tip.title).toBe('string')
  expect(typeof tip.content).toBe('string')
  expect(tip.id.length).toBeGreaterThan(0)
  expect(tip.title.length).toBeGreaterThan(0)
  expect(tip.content.length).toBeGreaterThan(0)
}

describe('education-service', () => {
  describe('getDailyTip', () => {
    it('returns a valid tip', () => {
      const tip = getDailyTip()
      validateTip(tip)
    })

    it('returns deterministic tip for same date', () => {
      const tip1 = getDailyTip()
      const tip2 = getDailyTip()
      expect(tip1.id).toBe(tip2.id)
    })
  })

  describe('getTipsByTopic', () => {
    it('filters tips by budgeting topic', () => {
      const tips = getTipsByTopic('budgeting')
      expect(tips.length).toBeGreaterThan(0)
      for (const tip of tips) {
        expect(tip.topic).toBe('budgeting')
        validateTip(tip)
      }
    })

    it('filters tips by saving topic', () => {
      const tips = getTipsByTopic('saving')
      expect(tips.length).toBeGreaterThan(0)
      tips.forEach((tip) => expect(tip.topic).toBe('saving'))
    })

    it('filters tips by investing topic', () => {
      const tips = getTipsByTopic('investing')
      expect(tips.length).toBeGreaterThan(0)
      tips.forEach((tip) => expect(tip.topic).toBe('investing'))
    })

    it('filters tips by debt topic', () => {
      const tips = getTipsByTopic('debt')
      expect(tips.length).toBeGreaterThan(0)
      tips.forEach((tip) => expect(tip.topic).toBe('debt'))
    })

    it('filters tips by general topic', () => {
      const tips = getTipsByTopic('general')
      expect(tips.length).toBeGreaterThan(0)
      tips.forEach((tip) => expect(tip.topic).toBe('general'))
    })
  })

  describe('getTipForAction', () => {
    it('maps first-budget to a budgeting tip', () => {
      const tip = getTipForAction('first-budget')
      expect(tip).not.toBeNull()
      expect(tip!.id).toBe('budget-50-30-20')
    })

    it('maps first-investment to investing tip', () => {
      const tip = getTipForAction('first-investment')
      expect(tip).not.toBeNull()
      expect(tip!.id).toBe('investing-dca')
    })

    it('maps debt-payment to debt tip', () => {
      const tip = getTipForAction('debt-payment')
      expect(tip).not.toBeNull()
      expect(tip!.id).toBe('debt-snowball-vs-avalanche')
    })

    it('returns null for unknown action', () => {
      const tip = getTipForAction('nonexistent-action')
      expect(tip).toBeNull()
    })

    it('returns tips with all required fields', () => {
      const actions = [
        'first-budget', 'create-budget', 'first-investment', 'add-investment',
        'first-transaction', 'credit-card-payment', 'debt-payment',
        'savings-deposit', 'view-spending', 'emergency-fund', 'view-net-worth',
      ]
      for (const action of actions) {
        const tip = getTipForAction(action)
        expect(tip).not.toBeNull()
        validateTip(tip!)
      }
    })
  })

  describe('getContextualTip', () => {
    it('returns tip matching topic name', () => {
      const tip = getContextualTip('budgeting')
      expect(tip).not.toBeNull()
      expect(tip!.topic).toBe('budgeting')
    })

    it('returns tip matching keyword in title', () => {
      const tip = getContextualTip('compound interest')
      expect(tip).not.toBeNull()
      expect(tip!.title.toLowerCase()).toContain('compound interest')
    })

    it('returns a fallback tip for unrelated context', () => {
      // Even unrelated queries should return something (random fallback)
      const tip = getContextualTip('xyzzy-unmatched-query-12345')
      expect(tip).not.toBeNull()
      validateTip(tip!)
    })
  })

  describe('getAllTips', () => {
    it('returns all tips', () => {
      const tips = getAllTips()
      expect(tips.length).toBeGreaterThanOrEqual(15) // We know there are 15 tips
      tips.forEach(validateTip)
    })

    it('returns a copy (not the original array)', () => {
      const tips1 = getAllTips()
      const tips2 = getAllTips()
      expect(tips1).not.toBe(tips2)
      expect(tips1).toEqual(tips2)
    })
  })
})
