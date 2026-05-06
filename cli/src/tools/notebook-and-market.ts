import {
  z,
  readNote,
  writeNote,
  appendNote,
  noteExists,
  listNotes,
  notebookPathSchema,
  type ToolDefinition,
} from './shared.js'

import { generatePortfolioReview as generatePortfolioReviewSummary } from '../insights.js'

const writeNotebookTool: ToolDefinition = {
  name: 'write-notebook',
  description:
    'Write or update a markdown note in the notebook. Use for research findings, portfolio reviews, market signals, and educational content.',
  schema: z.object({
    path: notebookPathSchema('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
    content: z.string().describe('Markdown content to write'),
    append: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, append to existing note instead of overwriting'),
  }),
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
}

// ---------------------------------------------------------------------------
// 26. read-notebook
// ---------------------------------------------------------------------------

const readNotebookTool: ToolDefinition = {
  name: 'read-notebook',
  description:
    'Read a note from the notebook. Use to reference previous research, reviews, or educational content.',
  schema: z.object({
    path: notebookPathSchema('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
  }),
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
}

// ---------------------------------------------------------------------------
// 27. list-notebook
// ---------------------------------------------------------------------------

const listNotebookTool: ToolDefinition = {
  name: 'list-notebook',
  description:
    'List notes and directories in the notebook. Use to discover available research, reviews, and educational content.',
  schema: z.object({
    directory: notebookPathSchema(
      'Subdirectory to list (e.g. "holdings", "weekly-reviews"). Omit for root.',
      { allowEmpty: true }
    ).optional(),
  }),
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
}

// ---------------------------------------------------------------------------
// 28. generate-portfolio-review
// ---------------------------------------------------------------------------

const generatePortfolioReview: ToolDefinition = {
  name: 'generate-portfolio-review',
  description:
    'Generate a portfolio review and save it to the notebook. Reviews include performance summary, top/worst performers, and a holdings table.',
  schema: z.object({
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force generation even if a review exists for this week'),
  }),
  execute: async ({ force }) => generatePortfolioReviewSummary(force),
}

// ---------------------------------------------------------------------------
// 29. manage-category-rules
// ---------------------------------------------------------------------------

export const notebookandmarketTools: ToolDefinition[] = [
  writeNotebookTool,
  readNotebookTool,
  listNotebookTool,
  generatePortfolioReview,
]
