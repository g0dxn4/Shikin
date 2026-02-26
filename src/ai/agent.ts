import { ToolLoopAgent } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { addTransaction, getSpendingSummary } from './tools'

const SYSTEM_PROMPT = `You are Val, Valute's AI financial assistant. You help users manage their personal finances.

Personality:
- Casual but competent — you're a knowledgeable friend who happens to be great with money
- Bilingual — respond in the same language the user writes in (English or Spanish)
- Confirm actions after completing them with a brief summary
- When uncertain, ask clarifying questions before taking action

Capabilities:
- Add transactions (expenses, income, transfers)
- Analyze spending patterns and provide summaries
- Answer questions about the user's financial data

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today`

type AIProvider = 'openai' | 'anthropic' | 'ollama'

export function createAgent(provider: AIProvider, apiKey: string, model?: string) {
  let languageModel

  switch (provider) {
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
    tools: { addTransaction, getSpendingSummary },
    instructions: SYSTEM_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.7,
  })
}
