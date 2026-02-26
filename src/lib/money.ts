import type { Money } from '@/types/common'

/** Convert a decimal amount (e.g. 12.50) to centavos (1250) */
export function toCentavos(amount: number): Money {
  return Math.round(amount * 100)
}

/** Convert centavos (1250) to a decimal amount (12.50) */
export function fromCentavos(centavos: Money): number {
  return centavos / 100
}

/** Format centavos as a currency string */
export function formatMoney(
  centavos: Money,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  const amount = fromCentavos(centavos)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount)
}

/** Add two money amounts safely (avoids floating point) */
export function addMoney(a: Money, b: Money): Money {
  return a + b
}

/** Subtract two money amounts safely */
export function subtractMoney(a: Money, b: Money): Money {
  return a - b
}
