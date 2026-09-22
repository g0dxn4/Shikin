import { fromCentavos } from '@/lib/money'

/** Compact axis label for values stored in centavos. Tooltips should keep using formatMoney. */
export function formatCompactChartMoney(
  centavos: number,
  currency: string,
  locale?: string
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(fromCentavos(centavos))
}
