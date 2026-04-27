import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enSettings from './locales/en/settings.json'
import enAccounts from './locales/en/accounts.json'
import enTransactions from './locales/en/transactions.json'
import enBudgets from './locales/en/budgets.json'
import enSubscriptions from './locales/en/subscriptions.json'
import enInvestments from './locales/en/investments.json'
import enDebtPayoff from './locales/en/debtPayoff.json'
import enForecast from './locales/en/forecast.json'
import enGoals from './locales/en/goals.json'
import enAnalytics from './locales/en/analytics.json'
import enBillCalendar from './locales/en/billCalendar.json'
import enInsights from './locales/en/insights.json'

import esCommon from './locales/es/common.json'
import esDashboard from './locales/es/dashboard.json'
import esSettings from './locales/es/settings.json'
import esAccounts from './locales/es/accounts.json'
import esTransactions from './locales/es/transactions.json'
import esBudgets from './locales/es/budgets.json'
import esSubscriptions from './locales/es/subscriptions.json'
import esInvestments from './locales/es/investments.json'
import esDebtPayoff from './locales/es/debtPayoff.json'
import esForecast from './locales/es/forecast.json'
import esGoals from './locales/es/goals.json'
import esAnalytics from './locales/es/analytics.json'
import esBillCalendar from './locales/es/billCalendar.json'
import esInsights from './locales/es/insights.json'

export const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    settings: enSettings,
    accounts: enAccounts,
    transactions: enTransactions,
    budgets: enBudgets,
    subscriptions: enSubscriptions,
    investments: enInvestments,
    debtPayoff: enDebtPayoff,
    forecast: enForecast,
    goals: enGoals,
    analytics: enAnalytics,
    billCalendar: enBillCalendar,
    insights: enInsights,
  },
  es: {
    common: esCommon,
    dashboard: esDashboard,
    settings: esSettings,
    accounts: esAccounts,
    transactions: esTransactions,
    budgets: esBudgets,
    subscriptions: esSubscriptions,
    investments: esInvestments,
    debtPayoff: esDebtPayoff,
    forecast: esForecast,
    goals: esGoals,
    analytics: esAnalytics,
    billCalendar: esBillCalendar,
    insights: esInsights,
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
      'subscriptions',
      'investments',
      'debtPayoff',
      'forecast',
      'goals',
      'analytics',
      'billCalendar',
      'insights',
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
