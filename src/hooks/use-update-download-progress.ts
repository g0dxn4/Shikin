import { useCallback, useState } from 'react'
import type { installUpdate } from '@/lib/updater'

type DownloadProgressHandler = NonNullable<Parameters<typeof installUpdate>[1]>

export function useUpdateDownloadProgress() {
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [downloadTotalBytes, setDownloadTotalBytes] = useState<number | null>(null)

  const resetDownloadProgress = useCallback(() => {
    setDownloadedBytes(0)
    setDownloadTotalBytes(null)
  }, [])

  const onDownloadProgress = useCallback<DownloadProgressHandler>((progress) => {
    if (progress.event === 'Started') {
      setDownloadTotalBytes(progress.data.contentLength ?? null)
      setDownloadedBytes(0)
      return
    }

    if (progress.event === 'Progress') {
      setDownloadedBytes((current) => current + progress.data.chunkLength)
    }
  }, [])

  return { downloadedBytes, downloadTotalBytes, resetDownloadProgress, onDownloadProgress }
}
