import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/transactions.json'
import es from '@/i18n/locales/es/transactions.json'

describe('transaction FX localization', () => {
  it.each([
    ['English', en],
    ['Spanish', es],
  ])('provides complete %s entry, preview, evidence, and restriction copy', (_language, locale) => {
    expect(locale.fx).toMatchObject({
      inputCurrency: expect.any(String),
      inputCurrencyHint: expect.any(String),
      previewLoading: expect.any(String),
      previewTitle: expect.any(String),
      rateProvenance: expect.stringContaining('{{rate}}'),
      acceptedEvidence: expect.stringContaining('{{input}}'),
      evidenceTitle: expect.any(String),
      evidenceDescription: expect.any(String),
      originalInput: expect.any(String),
      accountMovement: expect.any(String),
      acceptedRate: expect.any(String),
      transactionDate: expect.any(String),
      balanceContribution: expect.any(String),
      retained: expect.any(String),
    })
  })
})
