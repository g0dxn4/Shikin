import { DirectChatTransport } from 'ai'
import { createAgent, type AIProvider } from './agent'

export function createTransport(provider: AIProvider, apiKey: string, model?: string) {
  const agent = createAgent(provider, apiKey, model)

  return new DirectChatTransport({
    agent,
  })
}
