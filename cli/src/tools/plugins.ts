import type { ToolDefinition } from './shared.js'
import { boundedText, z } from './shared.js'
import { disablePlugin, enableTrustedLocalPlugin, listPluginSummaries } from '../plugins.js'

const pluginId = boundedText(
  'Plugin ID',
  'Plugin directory/manifest id to manage. Plugin IDs use kebab-case.',
  64
).regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Plugin ID must be kebab-case')

const listPlugins: ToolDefinition = {
  name: 'list-plugins',
  description: 'List local Shikin plugins discovered under the app data extensions directory.',
  schema: z.object({}),
  async execute() {
    const result = listPluginSummaries()
    return {
      success: true,
      extensionsDir: result.extensionsDir,
      plugins: result.plugins,
      count: result.plugins.length,
      message: `Found ${result.plugins.length} plugin${result.plugins.length === 1 ? '' : 's'}.`,
    }
  },
}

const enablePlugin: ToolDefinition = {
  name: 'enable-plugin',
  description: 'Enable a trusted-local plugin after explicitly approving its declared permissions.',
  schema: z.object({
    pluginId,
    trustedLocal: z
      .boolean()
      .default(false)
      .describe('Required confirmation that this local plugin code is trusted.'),
    approvePermissions: z
      .boolean()
      .default(false)
      .describe('Required confirmation that declared plugin permissions are approved.'),
    source: boundedText(
      'Source',
      'Automation source or origin label for plugin audit provenance',
      120
    ).optional(),
    note: boundedText(
      'Note',
      'Workflow changelog note for plugin audit provenance',
      500
    ).optional(),
    dryRun: z.boolean().default(false).describe('Preview enablement without writing plugin state.'),
  }),
  async execute(input) {
    return enableTrustedLocalPlugin(input)
  },
}

const disablePluginTool: ToolDefinition = {
  name: 'disable-plugin',
  description: 'Disable a local plugin so its tools no longer appear in new CLI/MCP catalogs.',
  schema: z.object({
    pluginId,
    source: boundedText(
      'Source',
      'Automation source or origin label for plugin audit provenance',
      120
    ).optional(),
    note: boundedText(
      'Note',
      'Workflow changelog note for plugin audit provenance',
      500
    ).optional(),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Preview disablement without writing plugin state.'),
  }),
  async execute(input) {
    return disablePlugin(input)
  },
}

export const pluginTools: ToolDefinition[] = [listPlugins, enablePlugin, disablePluginTool]
