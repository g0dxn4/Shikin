import { ToolLoopAgent } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  addTransaction,
  getSpendingSummary,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  listAccounts,
  createAccount,
  listCategories,
  getBalanceOverview,
  analyzeSpendingTrends,
} from './tools'

const SYSTEM_PROMPT = `You are Val, Valute's AI financial assistant. You help users manage their personal finances.

Personality:
- Casual but competent — you're a knowledgeable friend who happens to be great with money
- Bilingual — respond in the same language the user writes in (English or Spanish)
- Confirm actions after completing them with a brief summary
- When uncertain, ask clarifying questions before taking action

Capabilities:
- Add, update, and delete transactions (expenses, income, transfers)
- Search and filter transactions by date, category, account, or description
- Create and list accounts
- List categories
- Get a balance overview with month-over-month trends
- Analyze spending trends over multiple months with category breakdowns

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today
- Always query before answering data questions — never guess
- When deleting, confirm the item details before proceeding`

type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'openrouter'

export function createAgent(provider: AIProvider, apiKey: string, model?: string) {
  let languageModel

  switch (provider) {
    case 'openrouter': {
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
      })
      languageModel = openrouter(model || 'anthropic/claude-sonnet-4')
      break
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey })
      languageModel = openai(model || 'gpt-4o-mini')
      break
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      languageModel = anthropic(model || 'claude-sonnet-4-20250514')
      break
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })
      languageModel = ollama(model || 'llama3.2')
      break
    }
  }

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
      listCategories,
      getBalanceOverview,
      analyzeSpendingTrends,
    },
    instructions: SYSTEM_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.7,
  })
}
