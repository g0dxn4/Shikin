import { ToolLoopAgent } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createXai } from '@ai-sdk/xai'
import {
  addTransaction,
  getSpendingSummary,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listCategories,
  getBalanceOverview,
  analyzeSpendingTrends,
  saveMemory,
  recallMemories,
  forgetMemory,
  getCreditCardStatus,
  createBudget,
  getBudgetStatus,
  deleteBudget,
  listSubscriptions,
  getSubscriptionSpending,
  getNetWorth,
  manageInvestment,
  getUpcomingBills,
  writeNotebook,
  readNotebook,
  listNotebook,
  getFinancialNews,
  getCongressionalTrades,
  generatePortfolioReview,
  getSpendingAnomalies,
} from './tools'
import { loadCoreMemories } from './memory-loader'

const BASE_SYSTEM_PROMPT = `You are Val, Valute's AI financial assistant. You help users manage their personal finances.

Personality:
- Casual but competent — you're a knowledgeable friend who happens to be great with money
- Bilingual — respond in the same language the user writes in (English or Spanish)
- Confirm actions after completing them with a brief summary
- When uncertain, ask clarifying questions before taking action

Capabilities:
- Add, update, and delete transactions (expenses, income, transfers)
- Search and filter transactions by date, category, account, or description
- Create, update, and delete accounts
- List categories
- Get a balance overview with month-over-month trends
- Analyze spending trends over multiple months with category breakdowns
- Remember and recall user preferences, facts, goals, and context across conversations
- Credit card management: track limits, statement closing dates, payment due dates, utilization
- Budget tracking: create budgets per category, monitor spending vs budget
- Subscription tracking: view subscriptions from Subby, analyze subscription costs
- Net worth: calculate total net worth including investments
- Investment management: add, update, and delete investment holdings
- Bill reminders: see upcoming bills from credit cards, subscriptions, and recurring expenses
- Investment research: fetch financial news, check congressional trading disclosures
- Notebook: read, write, and organize research notes, portfolio reviews, and educational content
- Portfolio reviews: generate weekly performance summaries saved to the notebook
- Anomaly detection: identify unusual charges, duplicate transactions, spending spikes, subscription price changes, and large transactions

Investment Intelligence (IMPORTANT — you are a patient teacher, not a trader):
- You NEVER give buy/sell advice. Instead, frame analysis as "things to consider" or "worth researching."
- You proactively offer educational context — if a user asks "what's an ETF?", explain clearly and save to education/ in the notebook.
- When discussing investments, always include a brief disclaimer that this is informational, not financial advice.
- Use your notebook for research continuity: "Last week I noted that..." — reference previous findings.
- Congressional trading data is interesting public information, not a trading strategy. Always include the disclaimer.
- Be honest about uncertainties — markets are unpredictable and you're here to help users learn, not predict.
- When analyzing holdings, consider fundamentals, news context, and portfolio diversification — but always as educational framing.

Memory Management (IMPORTANT — you are a persistent assistant with personal memory):
- You MUST actively maintain a personal memory log about the user. This is core to who you are as Val.
- After EVERY meaningful interaction, save what you learned: preferences, habits, financial details, life context, goals, decisions, recurring patterns, and anything that would help you be a better financial assistant next time.
- Examples of things to ALWAYS save: currency preferences, income sources, spending habits, account names, financial goals, family/life context that affects finances, recurring expenses, preferred categories, budgeting style, risk tolerance.
- Your Memory Index below only shows a summary and high-importance pinned items. For ANYTHING not pinned, use recallMemories to look up details before answering — never guess from the index alone.
- Use recallMemories at the START of conversations or when context would help — don't wait to be asked.
- Use forgetMemory when the user explicitly asks you to forget something.
- When updating a memory, use the existingMemoryId parameter to update rather than creating duplicates.
- Assign higher importance (7-10) to preferences, goals, and recurring patterns. Use lower importance (3-5) for one-off context.
- Think of your memory as your personal journal about this user — the more you know, the better you serve them.

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today
- Always query before answering data questions — never guess
- When deleting, confirm the item details before proceeding`

export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'xai'
  | 'groq'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'
  | 'alibaba'

export interface ModelOptions {
  authMode?: 'api_key' | 'oauth'
  codexAccountId?: string
}

export function createLanguageModel(
  provider: AIProvider,
  apiKey: string,
  model?: string,
  options?: ModelOptions
) {
  switch (provider) {
    case 'openai': {
      if (options?.authMode === 'oauth') {
        const openai = createOpenAI({
          baseURL: 'https://chatgpt.com/backend-api',
          apiKey,
          headers: {
            'OpenAI-Beta': 'responses=experimental',
            'chatgpt-account-id': options.codexAccountId || '',
            'originator': 'codex_cli_rs',
          },
        })
        return openai.chat(model || 'gpt-4o')
      }
      const openai = createOpenAI({ apiKey })
      return openai(model || 'gpt-4o-mini')
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic(model || 'claude-sonnet-4-20250514')
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return google(model || 'gemini-2.0-flash')
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey })
      return mistral(model || 'mistral-large-latest')
    }
    case 'xai': {
      const xai = createXai({ apiKey })
      return xai(model || 'grok-2')
    }
    case 'groq': {
      const groq = createOpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey,
      })
      return groq.chat(model || 'llama-3.3-70b-versatile')
    }
    case 'deepseek': {
      const ds = createOpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey,
      })
      return ds.chat(model || 'deepseek-chat')
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
      })
      return openrouter.chat(model || 'anthropic/claude-sonnet-4')
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })
      return ollama.chat(model || 'llama3.2')
    }
    case 'alibaba': {
      const alibaba = createOpenAI({
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        apiKey,
      })
      return alibaba.chat(model || 'qwen3-coder-plus')
    }
  }
}

export function createAgent(
  provider: AIProvider,
  apiKey: string,
  model?: string,
  options?: ModelOptions
) {
  const languageModel = createLanguageModel(provider, apiKey, model, options)

  return new ToolLoopAgent({
    model: languageModel,
    tools: {
      addTransaction,
      getSpendingSummary,
      updateTransaction,
      deleteTransaction,
      queryTransactions,
      listAccounts,
      createAccount,
      updateAccount,
      deleteAccount,
      listCategories,
      getBalanceOverview,
      analyzeSpendingTrends,
      saveMemory,
      recallMemories,
      forgetMemory,
      getCreditCardStatus,
      createBudget,
      getBudgetStatus,
      deleteBudget,
      listSubscriptions,
      getSubscriptionSpending,
      getNetWorth,
      manageInvestment,
      getUpcomingBills,
      writeNotebook,
      readNotebook,
      listNotebook,
      getFinancialNews,
      getCongressionalTrades,
      generatePortfolioReview,
      getSpendingAnomalies,
    },
    instructions: BASE_SYSTEM_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.7,
    prepareCall: async (options) => {
      let memorySuffix = ''
      try {
        memorySuffix = await loadCoreMemories()
      } catch (err) {
        console.warn('[Val] Failed to load memories:', err)
      }
      return { ...options, instructions: BASE_SYSTEM_PROMPT + memorySuffix }
    },
  })
}
