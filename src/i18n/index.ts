import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enSettings from './locales/en/settings.json'
import enAi from './locales/en/ai.json'
import enAccounts from './locales/en/accounts.json'
import enTransactions from './locales/en/transactions.json'

import esCommon from './locales/es/common.json'
import esDashboard from './locales/es/dashboard.json'
import esSettings from './locales/es/settings.json'
import esAi from './locales/es/ai.json'
import esAccounts from './locales/es/accounts.json'
import esTransactions from './locales/es/transactions.json'

export const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    settings: enSettings,
    ai: enAi,
    accounts: enAccounts,
    transactions: enTransactions,
  },
  es: {
    common: esCommon,
    dashboard: esDashboard,
    settings: esSettings,
    ai: esAi,
    accounts: esAccounts,
    transactions: esTransactions,
  },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'dashboard', 'settings', 'ai', 'accounts', 'transactions'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
