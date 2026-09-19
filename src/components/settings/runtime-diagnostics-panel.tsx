import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getRuntimeDiagnostics, type RuntimeDiagnostics } from '@/lib/runtime-diagnostics'

const BUILD_LABEL_KEYS = {
  desktop: 'diagnostics.builds.desktop',
  'hosted-web': 'diagnostics.builds.hostedWeb',
  'browser-development': 'diagnostics.builds.browserDevelopment',
} as const

const UNAVAILABLE_REASON_KEYS = {
  missing: 'diagnostics.unavailable.missing',
  invalid: 'diagnostics.unavailable.invalid',
  unsafe: 'diagnostics.unavailable.unsafe',
  unreadable: 'diagnostics.unavailable.unreadable',
} as const

export function RuntimeDiagnosticsPanel() {
  const { t } = useTranslation('settings')
  const tRef = useRef(t)
  tRef.current = t
  const requestIdRef = useRef(0)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadDiagnostics = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      const result = await getRuntimeDiagnostics()
      if (requestId !== requestIdRef.current) return
      setDiagnostics(result)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      setDiagnostics(null)
      setError(getErrorMessage(caught, tRef.current('diagnostics.loadError')))
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadDiagnostics()
    return () => {
      requestIdRef.current += 1
    }
  }, [loadDiagnostics])

  const showInitialLoading = isLoading && diagnostics === null && error === null

  return (
    <div
      className="border-border bg-muted/50 space-y-3 rounded-lg border p-4"
      aria-busy={isLoading}
      aria-labelledby="runtime-diagnostics-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id="runtime-diagnostics-heading" className="text-sm font-semibold">
            {t('diagnostics.title')}
          </h3>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('diagnostics.description')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-11 shrink-0"
          onClick={() => {
            void loadDiagnostics()
          }}
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {isLoading ? t('diagnostics.refreshing') : t('diagnostics.refresh')}
        </Button>
      </div>

      {showInitialLoading ? (
        <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" />
          <span>{t('diagnostics.loading')}</span>
        </div>
      ) : null}

      {error ? <ErrorBanner title={t('diagnostics.errorTitle')} message={error} /> : null}

      {diagnostics ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DiagnosticRow
            label={t('diagnostics.build')}
            value={t(BUILD_LABEL_KEYS[diagnostics.build])}
          />
          <DiagnosticRow label={t('diagnostics.version')} value={diagnostics.version} />
          <DiagnosticRow
            label={t('diagnostics.schema')}
            value={`${diagnostics.schemaVersion} · ${diagnostics.schemaMigration}`}
            wrap
            className="sm:col-span-2"
          />
          <DiagnosticRow
            label={t('diagnostics.databaseLineage')}
            value={diagnostics.databaseLineageId}
            wrap
          />
          <DiagnosticRow
            label={t('diagnostics.localInstance')}
            value={
              diagnostics.localInstance.status === 'available'
                ? diagnostics.localInstance.id
                : t(UNAVAILABLE_REASON_KEYS[diagnostics.localInstance.reason])
            }
            wrap
          />
          <DiagnosticRow
            label={t('diagnostics.dataRevision')}
            value={String(diagnostics.dataRevision)}
            tabular
          />
          <DiagnosticRow
            label={t('diagnostics.lastFinancialWrite')}
            value={
              diagnostics.lastFinancialWriteAt === null
                ? t('diagnostics.lastFinancialWriteNever')
                : diagnostics.lastFinancialWriteAt
            }
            wrap={diagnostics.lastFinancialWriteAt !== null}
          />
        </dl>
      ) : null}
    </div>
  )
}

function DiagnosticRow({
  label,
  value,
  wrap = false,
  tabular = false,
  className,
}: {
  label: string
  value: string
  wrap?: boolean
  tabular?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
        {label}
      </dt>
      <dd
        className={
          wrap
            ? 'mt-1 font-mono text-xs leading-relaxed break-all'
            : tabular
              ? 'mt-1 text-sm font-medium tabular-nums'
              : 'mt-1 text-sm font-medium'
        }
      >
        {value}
      </dd>
    </div>
  )
}
