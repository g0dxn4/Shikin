import {
  convertCentavosAsOf,
  FX_CURRENCIES,
  selectValuationRatesAsOf,
  type DatedExchangeRate,
} from '@shikin/finance-core/fx'
import type { ValuationRate } from '@shikin/finance-core/valuation'
import { getErrorMessage } from '@/lib/errors'
import type { CurrencyState, PreferredCurrencyAmountResult } from './currency-store'

export interface CapturedCurrencyAuthority {
  mainCurrency: string | null
  preferredCurrency: string
  manualRates: readonly DatedExchangeRate[]
  asOfDate: string
  key: string
}

type CurrencyAuthorityState = Pick<
  CurrencyState,
  'mainCurrency' | 'preferredCurrency' | 'manualRates'
>

export function currencyAuthorityKey(
  state: Pick<CurrencyState, 'mainCurrency' | 'manualRates'>
): string {
  return `${state.mainCurrency ?? ''}|${state.manualRates.map((rate) => rate.id).join(',')}`
}

export function captureCurrencyAuthority(
  state: CurrencyAuthorityState,
  asOfDate: string
): CapturedCurrencyAuthority {
  return {
    mainCurrency: state.mainCurrency,
    preferredCurrency: state.preferredCurrency,
    manualRates: [...state.manualRates],
    asOfDate,
    key: currencyAuthorityKey(state),
  }
}

export function convertWithCurrencyAuthority(
  authority: CapturedCurrencyAuthority,
  amountCentavos: number,
  fromCurrency: string
): PreferredCurrencyAmountResult {
  const source = fromCurrency.trim().toUpperCase()
  const sourceIsSupported = (FX_CURRENCIES as readonly string[]).includes(source)
  if (!authority.mainCurrency) {
    return {
      complete: false,
      preferredCurrency: authority.preferredCurrency,
      missingCurrencies: sourceIsSupported ? [source] : [],
      reason: 'main_currency_unconfigured',
    }
  }

  if (!sourceIsSupported) {
    return {
      complete: false,
      preferredCurrency: authority.mainCurrency,
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      invalidCurrencies: [{ accountId: null, accountName: null, value: source }],
      invalidData: [`Unsupported currency: ${source}`],
    }
  }

  try {
    const conversion = convertCentavosAsOf({
      amountCentavos,
      fromCurrency: source,
      toCurrency: authority.mainCurrency,
      asOfDate: authority.asOfDate,
      rates: authority.manualRates,
    })
    if (!conversion.complete) {
      return {
        complete: false,
        preferredCurrency: authority.mainCurrency,
        missingCurrencies: [source],
        reason: 'missing_exchange_rates',
        conversion,
      }
    }
    return {
      complete: true,
      preferredCurrency: authority.mainCurrency,
      amountCentavos: conversion.amountCentavos,
      missingCurrencies: [],
      conversion,
    }
  } catch (error) {
    return {
      complete: false,
      preferredCurrency: authority.mainCurrency,
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      invalidData: [getErrorMessage(error)],
    }
  }
}

export function valuationRatesWithCurrencyAuthority(
  authority: CapturedCurrencyAuthority
): ValuationRate[] {
  return authority.mainCurrency
    ? selectValuationRatesAsOf(authority.manualRates, authority.mainCurrency, authority.asOfDate)
    : []
}
