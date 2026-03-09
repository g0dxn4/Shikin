import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { readNote, noteExists } from '@/lib/notebook'

export const readNotebook = tool({
  description:
    'Read a note from Val\'s notebook. Use to reference previous research, reviews, or educational content.',
  inputSchema: zodSchema(
    z.object({
      path: z
        .string()
        .describe('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
    })
  ),
  execute: async ({ path }) => {
    try {
      const exists = await noteExists(path)
      if (!exists) {
        return { success: false, message: `Note not found: ${path}` }
      }
      const content = await readNote(path)
      return { success: true, content, path }
    } catch (err) {
      return {
        success: false,
        message: `Failed to read notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
