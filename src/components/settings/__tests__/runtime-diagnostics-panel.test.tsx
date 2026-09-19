import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeDiagnostics } from '@/lib/runtime-diagnostics'
import { RuntimeDiagnosticsPanel } from '../runtime-diagnostics-panel'

const mockGetRuntimeDiagnostics = vi.fn()

vi.mock('@/lib/runtime-diagnostics', () => ({
  getRuntimeDiagnostics: (...args: unknown[]) => mockGetRuntimeDiagnostics(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const successDiagnostics: RuntimeDiagnostics = {
  success: true,
  build: 'desktop',
  version: '1.0.10',
  schemaVersion: 21,
  schemaMigration: '021_backend_remediation_foundation',
  databaseLineageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  localInstance: { status: 'available', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  dataRevision: 7,
  lastFinancialWriteAt: '2025-01-01T00:00:00.000Z',
}

function deferredDiagnostics() {
  let resolveRequest: (value: RuntimeDiagnostics) => void = () => {}
  const promise = new Promise<RuntimeDiagnostics>((resolve) => {
    resolveRequest = resolve
  })
  return { promise, resolveRequest }
}

describe('RuntimeDiagnosticsPanel', () => {
  beforeEach(() => {
    mockGetRuntimeDiagnostics.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders read-only diagnostics on success', async () => {
    mockGetRuntimeDiagnostics.mockResolvedValueOnce(successDiagnostics)

    render(<RuntimeDiagnosticsPanel />)

    expect(await screen.findByText('diagnostics.builds.desktop')).toBeInTheDocument()
    expect(screen.getByText('1.0.10')).toBeInTheDocument()
    expect(screen.getByText('21 · 021_backend_remediation_foundation')).toBeInTheDocument()
    expect(screen.getByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeInTheDocument()
    expect(screen.getByText('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('2025-01-01T00:00:00.000Z')).toBeInTheDocument()
    expect(screen.getByText('diagnostics.description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'diagnostics.refresh' })).toHaveClass('min-h-11')
    expect(mockGetRuntimeDiagnostics).toHaveBeenCalledWith()
  })

  it.each([
    ['missing', 'diagnostics.unavailable.missing'],
    ['invalid', 'diagnostics.unavailable.invalid'],
    ['unsafe', 'diagnostics.unavailable.unsafe'],
    ['unreadable', 'diagnostics.unavailable.unreadable'],
  ] as const)(
    'shows an honest %s local-instance reason without guessing an id',
    async (reason, key) => {
      mockGetRuntimeDiagnostics.mockResolvedValueOnce({
        ...successDiagnostics,
        localInstance: { status: 'unavailable', reason },
      })

      render(<RuntimeDiagnosticsPanel />)

      expect(await screen.findByText(key)).toBeInTheDocument()
      const instanceRow = screen.getByText('diagnostics.localInstance').closest('div')
      expect(instanceRow).toHaveTextContent(key)
      expect(instanceRow).not.toHaveTextContent(/[0-9a-f]{8}-[0-9a-f]{4}/i)
      expect(screen.queryByText('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).not.toBeInTheDocument()
    }
  )

  it('does not treat a missing last financial write as now', async () => {
    mockGetRuntimeDiagnostics.mockResolvedValueOnce({
      ...successDiagnostics,
      lastFinancialWriteAt: null,
    })

    render(<RuntimeDiagnosticsPanel />)

    expect(await screen.findByText('diagnostics.lastFinancialWriteNever')).toBeInTheDocument()
    const writeRow = screen.getByText('diagnostics.lastFinancialWrite').closest('div')
    expect(writeRow).toHaveTextContent('diagnostics.lastFinancialWriteNever')
    expect(writeRow).not.toHaveTextContent('2025-01-01T00:00:00.000Z')
    expect(writeRow?.textContent).not.toContain(new Date().toISOString().slice(0, 10))
    expect(screen.queryByText(/now/i)).not.toBeInTheDocument()
  })

  it('shows a load failure without crashing and can refresh', async () => {
    const user = userEvent.setup()
    mockGetRuntimeDiagnostics
      .mockRejectedValueOnce(new Error('bridge failed'))
      .mockResolvedValueOnce(successDiagnostics)

    render(<RuntimeDiagnosticsPanel />)

    expect(await screen.findByText('bridge failed')).toBeInTheDocument()
    expect(screen.getByText('diagnostics.errorTitle')).toBeInTheDocument()
    expect(screen.queryByText(successDiagnostics.databaseLineageId)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'diagnostics.refresh' }))

    expect(await screen.findByText(successDiagnostics.databaseLineageId)).toBeInTheDocument()
    expect(screen.queryByText('bridge failed')).not.toBeInTheDocument()
  })

  it('ignores stale diagnostics after a newer refresh', async () => {
    const user = userEvent.setup()
    const stale = {
      ...successDiagnostics,
      databaseLineageId: 'stale-lineage-id',
      dataRevision: 1,
    }
    const latest = {
      ...successDiagnostics,
      databaseLineageId: 'latest-lineage-id',
      dataRevision: 9,
    }
    const pending = deferredDiagnostics()

    mockGetRuntimeDiagnostics
      .mockResolvedValueOnce(successDiagnostics)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(latest)

    render(<RuntimeDiagnosticsPanel />)
    expect(await screen.findByText(successDiagnostics.databaseLineageId)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'diagnostics.refresh' }))
    await user.click(screen.getByRole('button', { name: 'diagnostics.refreshing' }))

    expect(await screen.findByText('latest-lineage-id')).toBeInTheDocument()

    await act(async () => {
      pending.resolveRequest(stale)
      await pending.promise
    })

    expect(screen.getByText('latest-lineage-id')).toBeInTheDocument()
    expect(screen.queryByText('stale-lineage-id')).not.toBeInTheDocument()
    expect(mockGetRuntimeDiagnostics).toHaveBeenCalledTimes(3)
  })

  it('ignores a response after unmount', async () => {
    const pending = deferredDiagnostics()
    mockGetRuntimeDiagnostics.mockReturnValueOnce(pending.promise)

    const { unmount } = render(<RuntimeDiagnosticsPanel />)
    expect(await screen.findByText('diagnostics.loading')).toBeInTheDocument()
    unmount()

    await act(async () => {
      pending.resolveRequest(successDiagnostics)
      await pending.promise
    })

    expect(screen.queryByText(successDiagnostics.databaseLineageId)).not.toBeInTheDocument()
  })

  it('keeps wrap-safe identity text and never invents filesystem paths', async () => {
    mockGetRuntimeDiagnostics.mockResolvedValueOnce(successDiagnostics)

    render(<RuntimeDiagnosticsPanel />)

    const lineage = await screen.findByText(successDiagnostics.databaseLineageId)
    const instance = screen.getByText(
      (successDiagnostics.localInstance as { status: 'available'; id: string }).id
    )
    expect(lineage).toHaveClass('break-all')
    expect(instance).toHaveClass('break-all')
    expect(screen.queryByText(/\/home\/|C:\\|\.db\b|app-data/i)).not.toBeInTheDocument()
  })

  it('shows a loading state before the first successful read', async () => {
    const pending = deferredDiagnostics()
    mockGetRuntimeDiagnostics.mockReturnValueOnce(pending.promise)

    render(<RuntimeDiagnosticsPanel />)

    expect(screen.getByText('diagnostics.loading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'diagnostics.refreshing' })).toBeInTheDocument()

    await act(async () => {
      pending.resolveRequest(successDiagnostics)
      await pending.promise
    })

    await waitFor(() => {
      expect(screen.queryByText('diagnostics.loading')).not.toBeInTheDocument()
    })
  })
})
