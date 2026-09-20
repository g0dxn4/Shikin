import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from './index'

const DETECTOR_CACHE_KEY = 'i18nextLng'

async function restoreEnglish() {
  localStorage.removeItem(DETECTOR_CACHE_KEY)
  await i18n.changeLanguage('en')
  document.documentElement.lang = 'en'
}

describe('html document lang tracks resolved language', () => {
  beforeEach(() => {
    localStorage.removeItem(DETECTOR_CACHE_KEY)
    document.documentElement.lang = 'en'
  })

  afterEach(async () => {
    await restoreEnglish()
  })

  it('applies cached English on detection', async () => {
    document.documentElement.lang = 'es'
    localStorage.setItem(DETECTOR_CACHE_KEY, 'en')

    await i18n.changeLanguage()

    expect(i18n.resolvedLanguage).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('applies cached Spanish on detection', async () => {
    localStorage.setItem(DETECTOR_CACHE_KEY, 'es')

    await i18n.changeLanguage()

    expect(i18n.resolvedLanguage).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('resolves regional Spanish (es-MX) to es, not es-MX', async () => {
    localStorage.setItem(DETECTOR_CACHE_KEY, 'es-MX')

    await i18n.changeLanguage()

    expect(i18n.language).toBe('es-MX')
    expect(i18n.resolvedLanguage).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('falls back to English for an unsupported language', async () => {
    document.documentElement.lang = 'es'
    localStorage.setItem(DETECTOR_CACHE_KEY, 'fr')

    await i18n.changeLanguage()

    expect(i18n.resolvedLanguage).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('updates document lang when switching Spanish to English at runtime', async () => {
    await i18n.changeLanguage('es')
    expect(i18n.resolvedLanguage).toBe('es')
    expect(document.documentElement.lang).toBe('es')

    await i18n.changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
