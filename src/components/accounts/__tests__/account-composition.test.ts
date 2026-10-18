import { describe, expect, it, vi } from 'vitest'
import {
  buildLiquidComposition,
  exactSharePercent,
  type CompositionAccount,
} from '../account-composition'
import type { ConvertedTotal, ConvertToPreferredFn } from '@/lib/accounts-group-converted-totals'

function identityConvert(currency = 'USD'): ConvertToPreferredFn {
  return (amountCentavos) => ({
    complete: true,
    preferredCurrency: currency,
    amountCentavos,
    missingCurrencies: [],
  })
}

function completeNet(amountCentavos: number, currency = 'USD'): ConvertedTotal {
  return {
    complete: true,
    preferredCurrency: currency,
    amountCentavos,
    missingCurrencies: [],
  }
}

const cash: CompositionAccount = {
  id: 'cash',
  type: 'cash',
  currency: 'USD',
  balance: 1,
}
const checking: CompositionAccount = {
  id: 'checking',
  type: 'checking',
  currency: 'USD',
  balance: 999,
}
const positiveCard: CompositionAccount = {
  id: 'card-pos',
  type: 'credit_card',
  currency: 'USD',
  balance: 50,
}
const cardDebt: CompositionAccount = {
  id: 'card-debt',
  type: 'credit_card',
  currency: 'USD',
  balance: -40,
}

describe('exactSharePercent', () => {
  it('does not inflate a small share to an 8% floor', () => {
    expect(exactSharePercent(1, 1000)).toBe('0.1%')
    expect(exactSharePercent(1, 1000)).not.toBe('8%')
    expect(exactSharePercent(0, 1000)).toBeNull()
  })
})

describe('buildLiquidComposition', () => {
  it('includes cash and a positive card balance and reconciles debt to the authority net', () => {
    const accounts = [cash, checking, positiveCard, cardDebt]
    const net = 1 + 999 + 50 - 40
    const result = buildLiquidComposition({
      accounts,
      convertToPreferred: identityConvert(),
      authorityNet: completeNet(net),
      groupedNet: [],
    })

    expect(result.kind).toBe('stack')
    if (result.kind !== 'stack') throw new Error('expected stack')
    expect(result.segments.map((segment) => segment.key)).toEqual([
      'checking',
      'cash',
      'creditPositive',
    ])
    expect(result.segments.find((segment) => segment.key === 'cash')?.amountCentavos).toBe(1)
    expect(
      result.segments.find((segment) => segment.key === 'creditPositive')?.amountCentavos
    ).toBe(50)
    expect(result.positiveCentavos - result.debtCentavos).toBe(result.netCentavos)
    expect(result.netCentavos).toBe(net)
    expect(result.debtKind).toBe('card')
    const cashWidth = result.segments.find((segment) => segment.key === 'cash')?.widthPercent
    expect(cashWidth).toBe(`${(1 / result.positiveCentavos) * 100}%`)
    expect(cashWidth).not.toBe('8%')
    expect(parseFloat(cashWidth ?? '8')).toBeLessThan(8)
  })

  it('does not convert or sum unlike currencies when the page net is incomplete', () => {
    const convert = vi.fn(() => {
      throw new Error('must not convert an incomplete total')
    })
    const result = buildLiquidComposition({
      accounts: [
        { id: 'usd', type: 'checking', currency: 'USD', balance: 250_000 },
        { id: 'eur', type: 'savings', currency: 'EUR', balance: 100_000 },
      ],
      convertToPreferred: convert as ConvertToPreferredFn,
      authorityNet: {
        complete: false,
        preferredCurrency: 'USD',
        amountCentavos: null,
        missingCurrencies: ['EUR'],
        reason: 'missing_exchange_rates',
      },
      groupedNet: [
        { currency: 'EUR', amountCentavos: 100_000 },
        { currency: 'USD', amountCentavos: 250_000 },
      ],
    })

    expect(convert).not.toHaveBeenCalled()
    expect(result).toEqual({
      kind: 'grouped',
      groups: [
        { currency: 'EUR', amountCentavos: 100_000 },
        { currency: 'USD', amountCentavos: 250_000 },
      ],
    })
    expect(result).not.toHaveProperty('netCentavos')
    expect(result).not.toHaveProperty('positiveCentavos')
  })

  it('does not draw a stack when converted parts do not match the authority net', () => {
    const result = buildLiquidComposition({
      accounts: [checking],
      convertToPreferred: identityConvert(),
      authorityNet: completeNet(checking.balance + 1),
      groupedNet: [{ currency: 'USD', amountCentavos: checking.balance }],
    })
    expect(result).toEqual({ kind: 'unreconciled' })
  })

  it('keeps other debt out of the card-debt label inputs', () => {
    const result = buildLiquidComposition({
      accounts: [
        { id: 'cash', type: 'cash', currency: 'USD', balance: 500 },
        { id: 'overdrawn', type: 'checking', currency: 'USD', balance: -100 },
      ],
      convertToPreferred: identityConvert(),
      authorityNet: completeNet(400),
      groupedNet: [],
    })
    expect(result.kind).toBe('stack')
    if (result.kind !== 'stack') throw new Error('expected stack')
    expect(result.debtKind).toBe('other')
    expect(result.debtCentavos).toBe(100)
    expect(result.positiveCentavos - result.debtCentavos).toBe(400)
  })
})
