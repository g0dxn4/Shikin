export function toCentavos(amount: number): number {
  return Math.round(amount * 100)
}

export function fromCentavos(centavos: number): number {
  return centavos / 100
}

export function formatMoney(centavos: number, currency: string = 'USD'): string {
  const amount = fromCentavos(centavos)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
