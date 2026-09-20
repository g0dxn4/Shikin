import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enSettings from './locales/en/settings.json'
import enAccounts from './locales/en/accounts.json'
import enTransactions from './locales/en/transactions.json'
import enBudgets from './locales/en/budgets.json'
import enInvestments from './locales/en/investments.json'
import enDebtPayoff from './locales/en/debtPayoff.json'
import enReceivables from './locales/en/receivables.json'
import enForecast from './locales/en/forecast.json'
import enGoals from './locales/en/goals.json'
import enAnalytics from './locales/en/analytics.json'
import enBillCalendar from './locales/en/billCalendar.json'
import enInsights from './locales/en/insights.json'
import enCategories from './locales/en/categories.json'
import enExtensions from './locales/en/extensions.json'
import enConsumption from './locales/en/consumption.json'
import enAccountHistory from './locales/en/accountHistory.json'
import enCardPayments from './locales/en/cardPayments.json'

import esCommon from './locales/es/common.json'
import esDashboard from './locales/es/dashboard.json'
import esSettings from './locales/es/settings.json'
import esAccounts from './locales/es/accounts.json'
import esTransactions from './locales/es/transactions.json'
import esBudgets from './locales/es/budgets.json'
import esInvestments from './locales/es/investments.json'
import esDebtPayoff from './locales/es/debtPayoff.json'
import esReceivables from './locales/es/receivables.json'
import esForecast from './locales/es/forecast.json'
import esGoals from './locales/es/goals.json'
import esAnalytics from './locales/es/analytics.json'
import esBillCalendar from './locales/es/billCalendar.json'
import esInsights from './locales/es/insights.json'
import esCategories from './locales/es/categories.json'
import esExtensions from './locales/es/extensions.json'
import esConsumption from './locales/es/consumption.json'
import esAccountHistory from './locales/es/accountHistory.json'
import esCardPayments from './locales/es/cardPayments.json'

export const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    settings: enSettings,
    accounts: enAccounts,
    transactions: enTransactions,
    budgets: enBudgets,
    investments: enInvestments,
    debtPayoff: enDebtPayoff,
    receivables: enReceivables,
    forecast: enForecast,
    goals: enGoals,
    analytics: enAnalytics,
    billCalendar: enBillCalendar,
    insights: enInsights,
    categories: enCategories,
    extensions: enExtensions,
    consumption: enConsumption,
    accountHistory: enAccountHistory,
    cardPayments: enCardPayments,
  },
  es: {
    common: esCommon,
    dashboard: esDashboard,
    settings: esSettings,
    accounts: esAccounts,
    transactions: esTransactions,
    budgets: esBudgets,
    investments: esInvestments,
    debtPayoff: esDebtPayoff,
    receivables: esReceivables,
    forecast: esForecast,
    goals: esGoals,
    analytics: esAnalytics,
    billCalendar: esBillCalendar,
    insights: esInsights,
    categories: esCategories,
    extensions: esExtensions,
    consumption: esConsumption,
    accountHistory: esAccountHistory,
    cardPayments: esCardPayments,
  },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'dashboard',
      'settings',
      'accounts',
      'transactions',
      'budgets',
      'investments',
      'debtPayoff',
      'receivables',
      'forecast',
      'goals',
      'analytics',
      'billCalendar',
      'insights',
      'categories',
      'extensions',
      'consumption',
      'accountHistory',
      'cardPayments',
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

type HtmlLangSync = () => void

const htmlLangSyncOwner = globalThis as typeof globalThis & {
  __shikinI18nHtmlLangSync?: HtmlLangSync
}

const syncHtmlDocumentLang: HtmlLangSync = () => {
  if (typeof document === 'undefined') return
  const lang = i18n.resolvedLanguage
  if (lang) document.documentElement.lang = lang
}

const previousHtmlLangSync = htmlLangSyncOwner.__shikinI18nHtmlLangSync
if (previousHtmlLangSync) {
  i18n.off('initialized', previousHtmlLangSync)
  i18n.off('languageChanged', previousHtmlLangSync)
}

htmlLangSyncOwner.__shikinI18nHtmlLangSync = syncHtmlDocumentLang
i18n.on('initialized', syncHtmlDocumentLang)
i18n.on('languageChanged', syncHtmlDocumentLang)

if (i18n.isInitialized) {
  syncHtmlDocumentLang()
}

export default i18n
