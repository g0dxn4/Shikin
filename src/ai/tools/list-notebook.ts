import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { listNotes } from '@/lib/notebook'

export const listNotebook = tool({
  description:
    'List notes and directories in Val\'s notebook. Use to discover available research, reviews, and educational content.',
  inputSchema: zodSchema(
    z.object({
      directory: z
        .string()
        .optional()
        .describe('Subdirectory to list (e.g. "holdings", "weekly-reviews"). Omit for root.'),
    })
  ),
  execute: async ({ directory }) => {
    try {
      const notes = await listNotes(directory)
      return {
        success: true,
        directory: directory || '/',
        notes,
        count: notes.length,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to list notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
