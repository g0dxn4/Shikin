// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cacheItemsFromStream, rewriteCodexProxyBody } from '../../scripts/data-server-chatgpt.mjs'

describe('data-server ChatGPT Codex proxy helpers', () => {
  it('rewrites request bodies for Codex compatibility and inlines cached items', () => {
    const itemCache = new Map([
      [
        'cached-tool-call',
        {
          id: 'cached-tool-call',
          type: 'function_call',
          name: 'lookupBudget',
        },
      ],
    ])

    const rewritten = rewriteCodexProxyBody(
      {
        store: true,
        max_output_tokens: 1024,
        previous_response_id: 'prior-response',
        input: [
          { role: 'developer', content: 'Follow the repo rules.' },
          { role: 'system', content: 'Stay concise.' },
          { role: 'user', content: 'What changed?' },
          { type: 'item_reference', id: 'cached-tool-call' },
        ],
      },
      itemCache
    )

    expect(rewritten.store).toBe(false)
    expect(rewritten).not.toHaveProperty('max_output_tokens')
    expect(rewritten).not.toHaveProperty('previous_response_id')
    expect(rewritten.instructions).toBe('Follow the repo rules.\n\nStay concise.')
    expect(rewritten.input).toEqual([
      { role: 'user', content: 'What changed?' },
      {
        id: 'cached-tool-call',
        type: 'function_call',
        name: 'lookupBudget',
      },
    ])
  })

  it('caches both completed responses and incremental output items from SSE chunks', () => {
    const itemCache = new Map()

    cacheItemsFromStream(
      [
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","item":{"id":"item-1","type":"message"}}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"output":[{"id":"item-2","type":"function_call"}]}}',
        '',
      ].join('\n'),
      itemCache
    )

    expect(itemCache.get('item-1')).toEqual({ id: 'item-1', type: 'message' })
    expect(itemCache.get('item-2')).toEqual({ id: 'item-2', type: 'function_call' })
  })
})
