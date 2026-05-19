// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockQuery, mockExecute } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
}))

vi.mock('./database.js', () => ({
  query: mockQuery,
  execute: mockExecute,
  transaction: vi.fn((fn: () => unknown) => fn()),
  close: vi.fn(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))

vi.mock('./ulid.js', () => ({
  generateId: () => 'plugin_test_id',
}))

const {
  disablePlugin,
  discoverPluginManifests,
  enableTrustedLocalPlugin,
  listPluginSummaries,
  loadEnabledPluginToolDefinitions,
  readPluginEnablementState,
  writePluginEnablementState,
} = await import('./plugins.js')

function writePlugin(
  extensionsDir: string,
  id: string,
  manifest: Record<string, unknown>,
  mainSource: string
) {
  const pluginDir = join(extensionsDir, id)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'manifest.json'), `${JSON.stringify({ id, ...manifest })}\n`)
  writeFileSync(join(pluginDir, manifest.main as string), mainSource)
}

describe('plugin foundation MVP', () => {
  let extensionsDir: string
  const originalExtensionsDir = process.env.SHIKIN_EXTENSIONS_DIR

  beforeEach(() => {
    extensionsDir = mkdtempSync(join(tmpdir(), 'shikin-plugins-'))
    process.env.SHIKIN_EXTENSIONS_DIR = extensionsDir
    mockQuery.mockReset()
    mockExecute.mockReset()
    mockExecute.mockReturnValue({ rowsAffected: 1, lastInsertId: 1 })
  })

  afterEach(() => {
    rmSync(extensionsDir, { recursive: true, force: true })
    if (originalExtensionsDir === undefined) {
      delete process.env.SHIKIN_EXTENSIONS_DIR
    } else {
      process.env.SHIKIN_EXTENSIONS_DIR = originalExtensionsDir
    }
  })

  it('discovers disabled plugins without loading their main module', () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: ['read:accounts'],
        tools: [{ name: 'greet', description: 'Greet someone', handler: 'greet' }],
      },
      'throw new Error("disabled plugins must not load")\n'
    )

    expect(discoverPluginManifests(extensionsDir)).toHaveLength(1)
    expect(loadEnabledPluginToolDefinitions([], extensionsDir)).toEqual([])

    const listed = listPluginSummaries(extensionsDir)
    expect(listed.plugins[0]).toMatchObject({
      id: 'demo',
      enabled: false,
      status: 'disabled',
      loadable: false,
      tools: [{ name: 'greet', publicName: 'plugin-demo-greet' }],
    })
  })

  it('loads enabled trusted-local tools and exposes permission-gated context APIs', async () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: ['read:accounts', 'read:extension_data', 'write:extension_data'],
        tools: [
          {
            name: 'greet',
            description: 'Greet someone',
            handler: 'greet',
            input: {
              name: { type: 'string', required: true, description: 'Name to greet' },
            },
          },
        ],
      },
      `export async function greet(input, ctx) {
        const accounts = await ctx.finance.listAccounts()
        await ctx.data.set('last-name', input.name)
        const stored = await ctx.data.get('last-name')
        return { greeting: 'hello ' + input.name, accountCount: accounts.length, accountBalance: accounts[0].balance, stored }
      }\n`
    )
    writePluginEnablementState(
      {
        version: 1,
        plugins: {
          demo: {
            enabled: true,
            mode: 'trusted-local',
            approvedPermissions: ['read:accounts', 'read:extension_data', 'write:extension_data'],
            approvedAt: '2026-05-18T00:00:00.000Z',
            manifestVersion: '1.0.0',
          },
        },
      },
      extensionsDir
    )
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'acct-1',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 12345,
          isArchived: 0,
        },
      ])
      .mockReturnValueOnce([{ value: '"Ava"' }])

    const pluginTools = loadEnabledPluginToolDefinitions([], extensionsDir)
    const greet = pluginTools.find((tool) => tool.name === 'plugin-demo-greet')!

    const result = await greet.execute(greet.schema.parse({ name: 'Ava' }))

    expect(greet.description).toBe('[Plugin: Demo Plugin] Greet someone')
    expect(result).toEqual({
      success: true,
      greeting: 'hello Ava',
      accountCount: 1,
      accountBalance: 123.45,
      stored: 'Ava',
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO extension_data'),
      ['plugin_test_id', 'demo', 'last-name', '"Ava"']
    )
  })

  it('denies structured API calls that lack declared and approved permissions', async () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: ['read:extension_data'],
        tools: [{ name: 'accounts', description: 'Read accounts', handler: 'accounts' }],
      },
      `export async function accounts(_input, ctx) {
        return { accounts: await ctx.finance.listAccounts() }
      }\n`
    )
    writePluginEnablementState(
      {
        version: 1,
        plugins: {
          demo: {
            enabled: true,
            mode: 'trusted-local',
            approvedPermissions: ['read:extension_data'],
            approvedAt: '2026-05-18T00:00:00.000Z',
            manifestVersion: '1.0.0',
          },
        },
      },
      extensionsDir
    )

    const pluginTools = loadEnabledPluginToolDefinitions([], extensionsDir)
    const accounts = pluginTools.find((tool) => tool.name === 'plugin-demo-accounts')!

    await expect(accounts.execute({})).resolves.toMatchObject({
      success: false,
      reason: 'plugin_permission_denied',
      permission: 'read:accounts',
    })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rechecks enablement before executing stale plugin tool definitions', async () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: [],
        tools: [{ name: 'greet', description: 'Greet someone', handler: 'greet' }],
      },
      `export async function greet() {
        throw new Error('disabled plugin code executed')
      }\n`
    )
    writePluginEnablementState(
      {
        version: 1,
        plugins: {
          demo: {
            enabled: true,
            mode: 'trusted-local',
            approvedPermissions: [],
            approvedAt: '2026-05-18T00:00:00.000Z',
            manifestVersion: '1.0.0',
          },
        },
      },
      extensionsDir
    )
    const [greet] = loadEnabledPluginToolDefinitions([], extensionsDir)

    writePluginEnablementState(
      {
        version: 1,
        plugins: {
          demo: {
            enabled: false,
            mode: 'trusted-local',
            approvedPermissions: [],
            approvedAt: '2026-05-18T00:00:00.000Z',
            disabledAt: '2026-05-18T00:01:00.000Z',
            manifestVersion: '1.0.0',
          },
        },
      },
      extensionsDir
    )

    await expect(greet.execute({})).resolves.toMatchObject({
      success: false,
      reason: 'plugin_disabled',
    })
  })

  it('requires explicit trusted-local and permission approval before enabling plugins', () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: ['read:accounts'],
        tools: [{ name: 'greet', description: 'Greet someone', handler: 'greet' }],
      },
      'export async function greet() { return { ok: true } }\n'
    )

    expect(
      enableTrustedLocalPlugin({
        pluginId: 'demo',
        trustedLocal: false,
        approvePermissions: true,
        extensionsDir,
      })
    ).toMatchObject({ success: false, reason: 'trusted_local_required' })
    expect(
      enableTrustedLocalPlugin({
        pluginId: 'demo',
        trustedLocal: true,
        approvePermissions: false,
        extensionsDir,
      })
    ).toMatchObject({ success: false, reason: 'plugin_permission_approval_required' })

    const enabled = enableTrustedLocalPlugin({
      pluginId: 'demo',
      trustedLocal: true,
      approvePermissions: true,
      source: 'mcp',
      note: 'approve local plugin',
      extensionsDir,
    })

    expect(enabled).toMatchObject({ success: true, plugin: { id: 'demo', status: 'enabled' } })
    expect(readPluginEnablementState(extensionsDir).plugins.demo).toMatchObject({
      enabled: true,
      mode: 'trusted-local',
      approvedPermissions: ['read:accounts'],
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['plugin', 'demo', 'enable', 'mcp', 'approve local plugin'])
    )
  })

  it('disables plugins without removing approved state history', () => {
    writePluginEnablementState(
      {
        version: 1,
        plugins: {
          demo: {
            enabled: true,
            mode: 'trusted-local',
            approvedPermissions: ['read:accounts'],
            approvedAt: '2026-05-18T00:00:00.000Z',
            manifestVersion: '1.0.0',
          },
        },
      },
      extensionsDir
    )

    const result = disablePlugin({ pluginId: 'demo', extensionsDir })

    expect(result).toMatchObject({ success: true, pluginId: 'demo', enabled: false })
    expect(readPluginEnablementState(extensionsDir).plugins.demo).toMatchObject({
      enabled: false,
      approvedPermissions: ['read:accounts'],
      disabledAt: expect.any(String),
    })
  })

  it('does not remove another process plugin-state lock on contention', () => {
    writePlugin(
      extensionsDir,
      'demo',
      {
        name: 'Demo Plugin',
        version: '1.0.0',
        main: 'index.mjs',
        permissions: [],
        tools: [{ name: 'greet', description: 'Greet someone', handler: 'greet' }],
      },
      'export async function greet() { return { ok: true } }\n'
    )
    const lockPath = join(extensionsDir, 'plugin-state.json.lock')
    writeFileSync(lockPath, 'locked')

    expect(() =>
      enableTrustedLocalPlugin({
        pluginId: 'demo',
        trustedLocal: true,
        approvePermissions: true,
        extensionsDir,
      })
    ).toThrow('Plugin state is locked by another Shikin process. Try again shortly.')
    expect(existsSync(lockPath)).toBe(true)
  })
})
