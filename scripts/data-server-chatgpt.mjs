export function cacheItemsFromStream(chunk, itemCache) {
  // SSE format: "event: ...\ndata: {...}\n\n"
  const lines = chunk.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    try {
      const data = JSON.parse(line.slice(6))
      if (data.type === 'response.completed' && data.response?.output) {
        for (const item of data.response.output) {
          if (item.id) itemCache.set(item.id, item)
        }
      }
      if (data.type === 'response.output_item.done' && data.item?.id) {
        itemCache.set(data.item.id, data.item)
      }
    } catch {
      /* ignore malformed SSE data lines */
    }
  }
}

export function rewriteCodexProxyBody(bodyJson, itemCache) {
  bodyJson.store = false
  delete bodyJson.max_output_tokens
  delete bodyJson.previous_response_id

  if (Array.isArray(bodyJson.input)) {
    bodyJson.input = bodyJson.input.map((item) => {
      if (item.type === 'item_reference' && item.id && itemCache.has(item.id)) {
        return itemCache.get(item.id)
      }
      return item
    })

    if (!bodyJson.instructions) {
      const instructionMessages = bodyJson.input.filter(
        (message) => message.role === 'developer' || message.role === 'system'
      )

      if (instructionMessages.length > 0) {
        bodyJson.instructions = instructionMessages.map((message) => message.content).join('\n\n')
        bodyJson.input = bodyJson.input.filter(
          (message) => message.role !== 'developer' && message.role !== 'system'
        )
      }
    }
  }

  return bodyJson
}
