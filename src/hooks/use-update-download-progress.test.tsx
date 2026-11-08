import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUpdateDownloadProgress } from './use-update-download-progress'

describe('useUpdateDownloadProgress', () => {
  it('preserves cumulative bytes, zero and unknown totals, and ignored Finished events', () => {
    const { result } = renderHook(() => useUpdateDownloadProgress())
    const events: Parameters<typeof result.current.onDownloadProgress>[0][] = [
      { event: 'Progress', data: { chunkLength: 2 } },
      { event: 'Started', data: { contentLength: 0 } },
      { event: 'Progress', data: { chunkLength: 3 } },
      { event: 'Progress', data: { chunkLength: 4 } },
      { event: 'Finished' },
      { event: 'Started', data: {} },
    ]
    const tuples: [number, number | null][] = []
    for (const event of events) {
      act(() => result.current.onDownloadProgress(event))
      tuples.push([result.current.downloadedBytes, result.current.downloadTotalBytes])
    }
    expect(tuples).toEqual([
      [2, null],
      [0, 0],
      [3, 0],
      [7, 0],
      [7, 0],
      [0, null],
    ])
  })

  it('keeps callbacks stable and resets without clamping or inferring completion', () => {
    const { result, rerender } = renderHook(() => useUpdateDownloadProgress())
    const reset = result.current.resetDownloadProgress
    const progress = result.current.onDownloadProgress
    act(() => {
      progress({ event: 'Started', data: { contentLength: 10 } })
      progress({ event: 'Progress', data: { chunkLength: 12 } })
      progress({ event: 'Finished' })
    })
    expect([result.current.downloadedBytes, result.current.downloadTotalBytes]).toEqual([12, 10])
    rerender()
    expect(result.current.resetDownloadProgress).toBe(reset)
    expect(result.current.onDownloadProgress).toBe(progress)
    act(() => reset())
    expect([result.current.downloadedBytes, result.current.downloadTotalBytes]).toEqual([0, null])
  })

  it('keeps mounted instances and replacement lifetimes independent', () => {
    const app = renderHook(() => useUpdateDownloadProgress())
    const settings = renderHook(() => useUpdateDownloadProgress())
    const oldSettingsProgress = settings.result.current.onDownloadProgress
    act(() => {
      app.result.current.onDownloadProgress({ event: 'Started', data: { contentLength: 10 } })
      app.result.current.onDownloadProgress({ event: 'Progress', data: { chunkLength: 7 } })
      oldSettingsProgress({ event: 'Started', data: { contentLength: 20 } })
      oldSettingsProgress({ event: 'Progress', data: { chunkLength: 3 } })
    })
    expect([app.result.current.downloadedBytes, app.result.current.downloadTotalBytes]).toEqual([
      7, 10,
    ])
    expect([
      settings.result.current.downloadedBytes,
      settings.result.current.downloadTotalBytes,
    ]).toEqual([3, 20])
    settings.unmount()
    const replacement = renderHook(() => useUpdateDownloadProgress())
    act(() => oldSettingsProgress({ event: 'Progress', data: { chunkLength: 100 } }))
    expect([
      replacement.result.current.downloadedBytes,
      replacement.result.current.downloadTotalBytes,
    ]).toEqual([0, null])
    expect([app.result.current.downloadedBytes, app.result.current.downloadTotalBytes]).toEqual([
      7, 10,
    ])
  })
})
