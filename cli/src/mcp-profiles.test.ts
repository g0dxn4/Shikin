// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CORE_MCP_TOOL_NAMES,
  getMcpCapabilities,
  isReadOnlyMcpTool,
  resolveMcpOptions,
  selectMcpTools,
} from './mcp-profiles.js'
import type { ToolDefinition } from './tools/shared.js'

function definition(name: string, effects?: ToolDefinition['effects']): ToolDefinition {
  return {
    name,
    description: 'Synthetic profile test tool',
    schema: z.object({}),
    execute: async () => ({ success: true }),
    ...(effects ? { effects } : {}),
  }
}

describe('MCP startup profiles', () => {
  it('preserves the full, writable compatibility profile by default', () => {
    expect(resolveMcpOptions([], {})).toEqual({ profile: 'full', readOnly: false })
  })

  it('supports explicit profiles and a restriction-only read-only flag', () => {
    expect(resolveMcpOptions(['--profile', 'core', '--read-only'], {})).toEqual({
      profile: 'core',
      readOnly: true,
    })
    expect(
      resolveMcpOptions(['--profile=full'], {
        SHIKIN_MCP_PROFILE: 'core',
        SHIKIN_MCP_READ_ONLY: '1',
      })
    ).toEqual({ profile: 'full', readOnly: true })
    expect(Object.isFrozen(resolveMcpOptions([], {}))).toBe(true)
  })

  it.each([
    [['--profile'], {}, /requires/],
    [['--profile', 'admin'], {}, /Invalid MCP profile/],
    [['--profile='], {}, /Invalid MCP profile/],
    [['--read-only=false'], {}, /Unknown MCP option/],
    [['--sql'], {}, /Unknown MCP option/],
    [[], { SHIKIN_MCP_PROFILE: 'admin' }, /Invalid MCP profile/],
    [[], { SHIKIN_MCP_READ_ONLY: 'yes' }, /SHIKIN_MCP_READ_ONLY/],
  ] as const)('rejects invalid or ambiguous configuration %j', (args, env, message) => {
    expect(() => resolveMcpOptions(args, env)).toThrow(message)
  })

  it('selects a fixed, deterministic core without changing the shared registry', () => {
    const original = [definition('undo'), definition('advanced-only'), definition('list-accounts')]
    const originalNames = original.map((tool) => tool.name)
    expect(selectMcpTools(original).map((tool) => tool.name)).toEqual([
      'advanced-only',
      'list-accounts',
      'undo',
    ])
    expect(
      selectMcpTools(original, { profile: 'core', readOnly: false }).map((tool) => tool.name)
    ).toEqual(['list-accounts', 'undo'])
    expect(original.map((tool) => tool.name)).toEqual(originalNames)
    expect(new Set(CORE_MCP_TOOL_NAMES).size).toBe(CORE_MCP_TOOL_NAMES.length)
  })

  it('fails closed for writes, unknown or contradictory effects, and plugin code', () => {
    const safe = definition('list-accounts', { readOnly: true, writesTo: [] })
    const candidates = [
      safe,
      definition('add-transaction', { readOnly: false }),
      definition('automation-context'),
      definition('contradictory', { readOnly: true, writesTo: ['accounts'] }),
      definition('plugin-example-read', { readOnly: true, writesTo: [] }),
    ]
    expect(candidates.map(isReadOnlyMcpTool)).toEqual([true, false, false, false, false])
    expect(selectMcpTools(candidates, { profile: 'full', readOnly: true })).toEqual([safe])
    expect(selectMcpTools(candidates, { profile: 'core', readOnly: true })).toEqual([safe])
  })

  it('reports only the active tools and permission-filtered alternative profile counts', () => {
    const candidates = [
      definition('list-accounts', { readOnly: true }),
      definition('undo', { writesTo: ['transactions'] }),
      definition('advanced-read', { readOnly: true }),
    ]
    expect(getMcpCapabilities(candidates, { profile: 'core', readOnly: true })).toMatchObject({
      profile: 'core',
      readOnly: true,
      discovery: 'fixed_at_startup',
      toolCount: 1,
      toolNames: ['list-accounts'],
      profiles: [
        { profile: 'full', toolCount: 2 },
        { profile: 'core', toolCount: 1 },
      ],
    })
  })
})
