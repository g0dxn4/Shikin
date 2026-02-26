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
  saveMemory,
  recallMemories,
  forgetMemory,
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
- Create and list accounts
- List categories
- Get a balance overview with month-over-month trends
- Analyze spending trends over multiple months with category breakdowns
- Remember and recall user preferences, facts, goals, and context across conversations

Memory Management:
- Use saveMemory to remember important user preferences, financial goals, personal facts, and behavioral patterns
- Proactively save memories when the user shares preferences (e.g. "I prefer MXN", "I'm saving for a car")
- Use recallMemories to search your saved memories when context would help answer a question
- Use forgetMemory when the user explicitly asks you to forget something
- When updating a memory, use the existingMemoryId parameter to update rather than creating duplicates
- Don't save trivial or session-specific information — focus on durable knowledge

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today
- Always query before answering data questions — never guess
- When deleting, confirm the item details before proceeding`

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'openrouter'

export function createLanguageModel(provider: AIProvider, apiKey: string, model?: string) {
  switch (provider) {
    case 'openrouter': {
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
      })
      return openrouter.chat(model || 'anthropic/claude-sonnet-4')
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey })
      return openai(model || 'gpt-4o-mini')
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic(model || 'claude-sonnet-4-20250514')
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })
      return ollama.chat(model || 'llama3.2')
    }
  }
}

export function createAgent(provider: AIProvider, apiKey: string, model?: string) {
  const languageModel = createLanguageModel(provider, apiKey, model)

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
      saveMemory,
      recallMemories,
      forgetMemory,
    },
    instructions: BASE_SYSTEM_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.7,
    prepareCall: async (options) => {
      const memorySuffix = await loadCoreMemories()
      return { ...options, instructions: BASE_SYSTEM_PROMPT + memorySuffix }
    },
  })
}
