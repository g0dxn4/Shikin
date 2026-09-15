import { describe, expect, it } from 'vitest'
import {
  buildAccountsLiquidTotals,
  buildReceivablesStatusTotals,
  groupAmountsByCurrency,
  sumConvertedAmounts,
  type ConvertToPreferredFn,
  type PreferredAmountResult,
} from '../accounts-group-converted-totals'

function convertWithRates(preferred: string, rates: Record<string, number>): ConvertToPreferredFn {
  return (amountCentavos, fromCurrency) => {
    const currency = fromCurrency.trim().toUpperCase()
    if (!/^[A-Z0-9]{2,10}$/.test(currency)) {
      return {
        complete: false,
        preferredCurrency: preferred,
        missingCurrencies: [],
        reason: 'invalid_currency_data',
      }
    }
    if (currency === preferred) {
      return {
        complete: true,
        preferredCurrency: preferred,
        amountCentavos,
        missingCurrencies: [],
      }
    }
    const rate = rates[`${currency}:${preferred}`]
    if (!rate) {
      return {
        complete: false,
        preferredCurrency: preferred,
        missingCurrencies: [currency],
        reason: 'missing_exchange_rates',
      }
    }
    return {
      complete: true,
      preferredCurrency: preferred,
      amountCentavos: Math.round(amountCentavos * rate),
      missingCurrencies: [],
    }
  }
}

function totalFromConvert(
  convertToPreferred: ConvertToPreferredFn
): (accounts: Array<{ currency: string; balance: number }>) => PreferredAmountResult {
  return (accounts) => {
    const summed = sumConvertedAmounts(
      accounts.map((account) => ({
        amountCentavos: account.balance,
        currency: account.currency,
      })),
      convertToPreferred,
      'USD'
    )
    if (summed.complete) {
      return {
        complete: true,
        preferredCurrency: summed.preferredCurrency,
        amountCentavos: summed.amountCentavos,
        missingCurrencies: [],
      }
    }
    return {
      complete: false,
      preferredCurrency: summed.preferredCurrency,
      missingCurrencies: summed.missingCurrencies,
      reason: summed.reason,
    }
  }
}

describe('sumConvertedAmounts', () => {
  it('returns a complete zero total for an empty list', () => {
    const convert = convertWithRates('USD', {})
    expect(sumConvertedAmounts([], convert, 'USD')).toEqual({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 0,
      missingCurrencies: [],
    })
  })

  it('sums same-currency amounts without a rate', () => {
    const convert = convertWithRates('USD', {})
    expect(
      sumConvertedAmounts(
        [
          { amountCentavos: 250_000, currency: 'USD' },
          { amountCentavos: 100_000, currency: 'USD' },
        ],
        convert,
        'USD'
      )
    ).toEqual({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 350_000,
      missingCurrencies: [],
    })
  })

  it('converts mixed currencies when every rate is present', () => {
    const convert = convertWithRates('USD', { 'EUR:USD': 1.1 })
    expect(
      sumConvertedAmounts(
        [
          { amountCentavos: 100_000, currency: 'USD' },
          { amountCentavos: 100_000, currency: 'EUR' },
        ],
        convert,
        'USD'
      )
    ).toEqual({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 210_000,
      missingCurrencies: [],
    })
  })

  it('does not return a partial mixed-currency total when a rate is missing', () => {
    const convert = convertWithRates('USD', {})
    expect(
      sumConvertedAmounts(
        [
          { amountCentavos: 250_000, currency: 'USD' },
          { amountCentavos: 100_000, currency: 'EUR' },
        ],
        convert,
        'USD'
      )
    ).toEqual({
      complete: false,
      preferredCurrency: 'USD',
      amountCentavos: null,
      missingCurrencies: ['EUR'],
      reason: 'missing_exchange_rates',
    })
  })
})

describe('groupAmountsByCurrency', () => {
  it('groups raw amounts by currency without converting', () => {
    expect(
      groupAmountsByCurrency([
        { amountCentavos: 250_000, currency: 'USD' },
        { amountCentavos: 50_000, currency: 'usd' },
        { amountCentavos: 100_000, currency: 'EUR' },
      ])
    ).toEqual([
      { currency: 'EUR', amountCentavos: 100_000 },
      { currency: 'USD', amountCentavos: 300_000 },
    ])
  })
})

describe('buildAccountsLiquidTotals', () => {
  const checking = {
    id: 'acc-usd',
    name: 'Checking',
    type: 'checking',
    currency: 'USD',
    balance: 250_000,
  }
  const savingsEur = {
    id: 'acc-eur',
    name: 'Savings',
    type: 'savings',
    currency: 'EUR',
    balance: 100_000,
  }
  const card = {
    id: 'acc-card',
    name: 'Card',
    type: 'credit_card',
    currency: 'USD',
    balance: -40_000,
  }

  it('converts same-currency liquid totals with assets and credit debt', () => {
    const convert = convertWithRates('USD', {})
    const totals = buildAccountsLiquidTotals({
      liquidAccounts: [checking, card],
      convertToPreferred: convert,
      getTotalBalanceInPreferred: totalFromConvert(convert),
      preferredCurrency: 'USD',
    })

    expect(totals.net).toEqual({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 210_000,
      missingCurrencies: [],
    })
    expect(totals.assets.amountCentavos).toBe(250_000)
    expect(totals.liabilities.amountCentavos).toBe(40_000)
    expect(totals.mix.checking.amountCentavos).toBe(250_000)
    expect(totals.conversionIssue).toBeNull()
  })

  it('refuses a mixed-currency net when a rate is missing', () => {
    const convert = convertWithRates('USD', {})
    const totals = buildAccountsLiquidTotals({
      liquidAccounts: [checking, savingsEur],
      convertToPreferred: convert,
      getTotalBalanceInPreferred: totalFromConvert(convert),
      preferredCurrency: 'USD',
    })

    expect(totals.net.complete).toBe(false)
    expect(totals.net.amountCentavos).toBeNull()
    if (totals.net.complete) throw new Error('expected incomplete net')
    expect(totals.net.missingCurrencies).toEqual(['EUR'])
    expect(totals.conversionIssue?.reason).toBe('missing_exchange_rates')
    expect(totals.groupedNet).toEqual([
      { currency: 'EUR', amountCentavos: 100_000 },
      { currency: 'USD', amountCentavos: 250_000 },
    ])
  })

  it('does not treat a converted EUR+USD mix as a raw centavo sum', () => {
    const convert = convertWithRates('USD', { 'EUR:USD': 2 })
    const totals = buildAccountsLiquidTotals({
      liquidAccounts: [checking, savingsEur],
      convertToPreferred: convert,
      getTotalBalanceInPreferred: totalFromConvert(convert),
      preferredCurrency: 'USD',
    })

    expect(totals.net).toMatchObject({ complete: true, amountCentavos: 450_000 })
    expect(totals.net.amountCentavos).not.toBe(350_000)
  })
})

describe('buildReceivablesStatusTotals', () => {
  it('converts outstanding, overdue, and received amounts', () => {
    const convert = convertWithRates('USD', {})
    const totals = buildReceivablesStatusTotals({
      receivables: [
        {
          status: 'partial',
          isOverdue: false,
          remainingAmount: 300_000,
          received_amount: 200_000,
          currency: 'USD',
        },
        {
          status: 'open',
          isOverdue: true,
          remainingAmount: 50_000,
          received_amount: 0,
          currency: 'USD',
        },
        {
          status: 'cancelled',
          isOverdue: false,
          remainingAmount: 80_000,
          received_amount: 10_000,
          currency: 'USD',
        },
      ],
      convertToPreferred: convert,
      preferredCurrency: 'USD',
    })

    expect(totals.outstanding.amountCentavos).toBe(350_000)
    expect(totals.overdue.amountCentavos).toBe(50_000)
    expect(totals.received.amountCentavos).toBe(200_000)
    expect(totals.conversionIssue).toBeNull()
  })

  it('omits mixed-currency receivable totals when a rate is missing', () => {
    const convert = convertWithRates('USD', {})
    const totals = buildReceivablesStatusTotals({
      receivables: [
        {
          status: 'open',
          isOverdue: false,
          remainingAmount: 300_000,
          received_amount: 0,
          currency: 'USD',
        },
        {
          status: 'open',
          isOverdue: true,
          remainingAmount: 100_000,
          received_amount: 0,
          currency: 'EUR',
        },
      ],
      convertToPreferred: convert,
      preferredCurrency: 'USD',
    })

    expect(totals.outstanding.complete).toBe(false)
    expect(totals.outstanding.amountCentavos).toBeNull()
    expect(totals.overdue.complete).toBe(false)
    expect(totals.conversionIssue?.missingCurrencies).toEqual(['EUR'])
    expect(totals.groupedOutstanding).toEqual([
      { currency: 'EUR', amountCentavos: 100_000 },
      { currency: 'USD', amountCentavos: 300_000 },
    ])
  })
})
