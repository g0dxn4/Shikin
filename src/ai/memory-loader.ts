import { query } from '@/lib/database'

interface MemoryRow {
  category: string
  content: string
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'User Preferences',
  fact: 'Known Facts',
  goal: 'Financial Goals',
  behavior: 'Behavioral Patterns',
  context: 'Context',
}

export async function loadCoreMemories(): Promise<string> {
  const memories = await query<MemoryRow>(
    `SELECT category, content FROM ai_memories
     ORDER BY importance DESC, updated_at DESC
     LIMIT 50`
  )

  if (memories.length === 0) return ''

  const grouped: Record<string, string[]> = {}
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = []
    grouped[m.category].push(m.content)
  }

  let block = '\n\n## Your Memories About This User\n'
  for (const [category, items] of Object.entries(grouped)) {
    block += `### ${CATEGORY_LABELS[category] || category}\n`
    for (const item of items) {
      block += `- ${item}\n`
    }
  }

  return block
}
