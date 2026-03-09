/**
 * Alibaba Qwen — DashScope OpenAI-compatible API.
 * No OAuth needed — standard API key auth.
 * The Coding Plan subscription gives a DashScope API key with higher rate limits.
 */

export const ALIBABA_CONFIG = {
  baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen3-coder-plus',
}

export const ALIBABA_MODELS: Array<{ id: string; name: string }> = [
  { id: 'qwen3-coder-plus', name: 'Qwen 3 Coder Plus' },
  { id: 'qwen-max', name: 'Qwen Max' },
  { id: 'qwen-plus', name: 'Qwen Plus' },
  { id: 'qwen-turbo', name: 'Qwen Turbo' },
  { id: 'qwen3-235b-a22b', name: 'Qwen 3 235B (MoE)' },
  { id: 'qwen3-32b', name: 'Qwen 3 32B' },
  { id: 'qwen3-14b', name: 'Qwen 3 14B' },
  { id: 'qwen3-8b', name: 'Qwen 3 8B' },
  { id: 'qwen3-4b', name: 'Qwen 3 4B' },
]
