import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { writeNote, appendNote } from '@/lib/notebook'

export const writeNotebook = tool({
  description:
    'Write or update a markdown note in Ivy\'s notebook. Use for research findings, portfolio reviews, market signals, and educational content. Paths are relative to the notebook directory (e.g. "holdings/AAPL.md", "education/what-is-an-etf.md").',
  inputSchema: zodSchema(
    z.object({
      path: z
        .string()
        .describe('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
      content: z.string().describe('Markdown content to write'),
      append: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, append to existing note instead of overwriting'),
    })
  ),
  execute: async ({ path, content, append }) => {
    try {
      if (append) {
        await appendNote(path, content)
      } else {
        await writeNote(path, content)
      }
      return {
        success: true,
        message: `${append ? 'Appended to' : 'Wrote'} notebook: ${path}`,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to write notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
