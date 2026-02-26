import { query } from '@/lib/database'

interface MemoryRow {
  category: string
  content: string
  importance: number
}

interface CategoryCount {
  category: string
  count: number
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Preferences',
  fact: 'Facts',
  goal: 'Goals',
  behavior: 'Patterns',
  context: 'Context',
}

const MAX_PINNED = 8

export async function loadCoreMemories(): Promise<string> {
  // Get counts per category
  const counts = await query<CategoryCount>(
    'SELECT category, COUNT(*) as count FROM ai_memories GROUP BY category'
  )

  if (counts.length === 0) return ''

  const total = counts.reduce((sum, c) => sum + c.count, 0)

  // Fetch only the highest-importance memories to pin in context
  const pinned = await query<MemoryRow>(
    `SELECT category, content, importance FROM ai_memories
     WHERE importance >= 7
     ORDER BY importance DESC, updated_at DESC
     LIMIT ${MAX_PINNED}`
  )

  let block = '\n\n## Memory Index\n'
  block += `You have ${total} saved memories: `
  block += counts.map((c) => `${c.count} ${CATEGORY_LABELS[c.category] || c.category}`).join(', ')
  block += '.\n'
  block += 'Use recallMemories to look up details — do NOT guess from this summary alone.\n'

  if (pinned.length > 0) {
    block += '\n### Pinned (importance >= 7)\n'
    for (const m of pinned) {
      block += `- [${CATEGORY_LABELS[m.category] || m.category}] ${m.content}\n`
    }
  }

  return block
}
