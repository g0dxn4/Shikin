import { DirectChatTransport } from 'ai'
import { createAgent } from './agent'

type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'openrouter'

export function createTransport(provider: AIProvider, apiKey: string, model?: string) {
  const agent = createAgent(provider, apiKey, model)

  return new DirectChatTransport({
    agent,
  })
}
