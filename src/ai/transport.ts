import { DirectChatTransport } from 'ai'
import { createAgent, type AIProvider, type ModelOptions } from './agent'

export function createTransport(
  provider: AIProvider,
  apiKey: string,
  model?: string,
  options?: ModelOptions
) {
  const agent = createAgent(provider, apiKey, model, options)

  return new DirectChatTransport({
    agent,
  })
}
