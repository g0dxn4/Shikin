import { useEffect } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  MonitorUp,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { cn } from '@/lib/utils'

export type OneClickUpdatePhase = 'available' | 'downloading' | 'ready' | 'restarting' | 'error'

interface OneClickUpdateCardProps {
  version: string
  phase: OneClickUpdatePhase
  error?: string | null
  downloadedBytes: number
  totalBytes: number | null
  readyToRestart: boolean
  onUpdateAndRestart: () => void
  onDismiss: () => void
}

export function OneClickUpdateCard({
  version,
  phase,
  error,
  downloadedBytes,
  totalBytes,
  readyToRestart,
  onUpdateAndRestart,
  onDismiss,
}: OneClickUpdateCardProps) {
  const { t } = useTranslation('common')
  const isBusy = phase === 'downloading' || phase === 'restarting'
  const progress = totalBytes !== null && totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
  const title = readyToRestart
    ? t('updates.prompt.readyTitle', { version })
    : t('updates.prompt.title', { version })
  const body = readyToRestart
    ? t('updates.prompt.readyDescription')
    : t('updates.prompt.description')
  const primaryLabel = readyToRestart
    ? phase === 'restarting'
      ? t('updates.prompt.restarting')
      : t('updates.prompt.restartNow')
    : phase === 'downloading'
      ? t('updates.prompt.installing')
      : t('updates.prompt.updateNow')
  const liveMessage =
    phase === 'error'
      ? error
        ? `${t('updates.prompt.errorTitle')}: ${error}`
        : t('updates.prompt.errorTitle')
      : phase === 'restarting'
        ? t('updates.prompt.restartingStatus')
        : readyToRestart
          ? t('updates.prompt.readyStatus')
          : phase === 'downloading'
            ? t('updates.prompt.downloadingStatus')
            : t('updates.prompt.availableStatus')

  useEffect(() => {
    if (isBusy) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (event.key === 'Escape') {
        onDismiss()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isBusy, onDismiss])

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-50 flex justify-end md:right-5 md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))] md:left-auto">
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>
      <div className="liquid-card animate-slide-in-right pointer-events-auto w-full max-w-[430px] overflow-hidden">
        <div className="relative isolate p-4 sm:p-5">
          <div
            className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_16%_8%,rgba(191,164,255,0.34),transparent_16rem),radial-gradient(circle_at_92%_86%,rgba(52,211,153,0.12),transparent_14rem)]"
            aria-hidden="true"
          />
          <div
            className="absolute top-0 right-8 left-8 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
            aria-hidden="true"
          />

          <div className="flex items-start gap-3">
            <div className="relative grid size-12 shrink-0 place-items-center rounded-lg border border-white/[0.12] bg-white/[0.08] shadow-[0_18px_50px_rgba(124,92,255,0.18)]">
              <MonitorUp size={22} className="text-accent-hover" aria-hidden="true" />
              <span
                className="bg-success text-background ring-background absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full ring-4"
                aria-hidden="true"
              >
                <ShieldCheck size={12} />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-accent-hover font-mono text-[10px] font-bold tracking-[0.22em] uppercase">
                    {t('updates.prompt.badge')}
                  </p>
                  <p className="font-heading mt-1 text-lg leading-tight font-semibold tracking-tight text-white">
                    {title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={isBusy}
                  className="focus-visible:ring-ring rounded-full p-2.5 text-white/45 transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
                  aria-label={t('updates.prompt.dismiss')}
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-muted-foreground mt-2 text-sm leading-5">{body}</p>

              <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2.5">
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full',
                    phase === 'error'
                      ? 'bg-destructive/15 text-destructive'
                      : readyToRestart && phase !== 'restarting'
                        ? 'bg-success/15 text-success'
                        : 'bg-accent-muted text-accent-hover'
                  )}
                  aria-hidden="true"
                >
                  {phase === 'error' ? (
                    <AlertTriangle size={15} />
                  ) : phase === 'downloading' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : phase === 'restarting' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : readyToRestart ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <Download size={15} />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">
                    {phase === 'error'
                      ? t('updates.prompt.errorTitle')
                      : phase === 'restarting'
                        ? t('updates.prompt.restartingStatus')
                        : readyToRestart
                          ? t('updates.prompt.readyStatus')
                          : phase === 'downloading'
                            ? t('updates.prompt.downloadingStatus')
                            : t('updates.prompt.availableStatus')}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {phase === 'error' && error
                      ? error
                      : phase === 'downloading' && totalBytes !== null && totalBytes > 0
                        ? t('updates.prompt.downloadProgress', {
                            downloaded: formatBytes(downloadedBytes),
                            total: formatBytes(totalBytes),
                          })
                        : t('updates.prompt.signedStatus')}
                  </p>
                </div>
                {phase === 'downloading' && (
                  <ProgressBar
                    className="col-span-2 mt-1"
                    value={progress}
                    color="accent"
                    size="sm"
                    ariaLabel={t('updates.prompt.downloadProgressAria')}
                  />
                )}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={onUpdateAndRestart}
                  disabled={isBusy}
                  className="h-11 flex-1"
                >
                  {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {primaryLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const sizeIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const size = bytes / 1024 ** sizeIndex

  return `${size.toFixed(size >= 10 || sizeIndex === 0 ? 0 : 1)} ${units[sizeIndex]}`
}
