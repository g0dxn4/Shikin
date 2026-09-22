import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConsumptionRole } from '@shikin/finance-core/corrections'
import { Archive, Check, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  archiveClassificationType,
  createClassificationType,
  listClassificationTypes,
  reviseClassificationType,
  type ClassificationTypeCatalog,
} from '@/lib/classification-type-service'
import { getErrorMessage } from '@/lib/errors'

interface TypeDraft {
  name: string
  financialTreatment: ConsumptionRole
  auditNote: string
}

interface EditDraft extends TypeDraft {
  typeId: string
  expectedRevisionId: string
}

const EMPTY_DRAFT: TypeDraft = {
  name: '',
  financialTreatment: 'purchase',
  auditNote: '',
}

export function ClassificationTypesSettings() {
  const { t } = useTranslation('settings')
  const { t: tConsumption } = useTranslation('consumption')
  const [catalog, setCatalog] = useState<ClassificationTypeCatalog | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [createDraft, setCreateDraft] = useState<TypeDraft>(EMPTY_DRAFT)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [archiveNotes, setArchiveNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [mutation, setMutation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const load = useCallback(
    async (options: { preserveError?: boolean } = {}) => {
      const sequence = ++requestSequence.current
      setLoading(true)
      try {
        const next = await listClassificationTypes(includeArchived)
        if (sequence !== requestSequence.current) return
        setCatalog(next)
        if (!options.preserveError) setError(null)
      } catch (loadError) {
        if (sequence === requestSequence.current) setError(getErrorMessage(loadError))
      } finally {
        if (sequence === requestSequence.current) setLoading(false)
      }
    },
    [includeArchived]
  )

  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  const refreshAfterFailure = async (mutationError: unknown) => {
    setError(getErrorMessage(mutationError))
    setNotice(null)
    await load({ preserveError: true })
  }

  const create = async () => {
    setMutation('create')
    setError(null)
    setNotice(null)
    try {
      await createClassificationType({
        name: createDraft.name,
        financialTreatment: createDraft.financialTreatment,
        auditNote: createDraft.auditNote || undefined,
      })
      setCreateDraft(EMPTY_DRAFT)
      setNotice(t('classificationTypes.created'))
      await load()
    } catch (mutationError) {
      await refreshAfterFailure(mutationError)
    } finally {
      setMutation(null)
    }
  }

  const revise = async () => {
    if (!editDraft) return
    setMutation(editDraft.typeId)
    setError(null)
    setNotice(null)
    try {
      await reviseClassificationType({
        typeId: editDraft.typeId,
        expectedRevisionId: editDraft.expectedRevisionId,
        name: editDraft.name,
        financialTreatment: editDraft.financialTreatment,
        auditNote: editDraft.auditNote || undefined,
      })
      setEditDraft(null)
      setNotice(t('classificationTypes.revised'))
      await load()
    } catch (mutationError) {
      // Refresh the catalog, but retain the operator's draft and expected revision.
      await refreshAfterFailure(mutationError)
    } finally {
      setMutation(null)
    }
  }

  const archive = async (typeId: string, expectedRevisionId: string) => {
    setMutation(typeId)
    setError(null)
    setNotice(null)
    try {
      const auditNote = archiveNotes[typeId]?.trim()
      await archiveClassificationType({
        typeId,
        expectedRevisionId,
        ...(auditNote ? { auditNote } : {}),
      })
      setArchiveNotes((current) => {
        const next = { ...current }
        delete next[typeId]
        return next
      })
      if (editDraft?.typeId === typeId) setEditDraft(null)
      setNotice(t('classificationTypes.archived'))
      await load()
    } catch (mutationError) {
      await refreshAfterFailure(mutationError)
    } finally {
      setMutation(null)
    }
  }

  const definitions = catalog?.definitions ?? []
  const treatments = definitions.filter((entry) => entry.kind === 'builtin')

  return (
    <div className="min-w-0 space-y-5">
      <div className="border-warning/25 bg-warning/10 text-foreground space-y-1 rounded-lg border p-3 text-xs leading-relaxed">
        <p>{t('classificationTypes.revisionWarning')}</p>
        <p>{t('classificationTypes.archiveWarning')}</p>
      </div>

      {error ? (
        <div className="border-destructive/30 bg-destructive/10 rounded-lg border p-3" role="alert">
          <p className="text-sm">{error}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('classificationTypes.draftPreserved')}
          </p>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {notice}
      </div>

      <section className="border-border min-w-0 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">{t('classificationTypes.createTitle')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('classificationTypes.createDescription')}
        </p>
        <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="classification-type-name">{t('classificationTypes.name')}</Label>
            <Input
              id="classification-type-name"
              maxLength={100}
              value={createDraft.name}
              disabled={mutation !== null}
              onChange={(event) =>
                setCreateDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>
          <TreatmentSelect
            id="classification-type-treatment"
            value={createDraft.financialTreatment}
            treatments={treatments}
            disabled={mutation !== null}
            label={t('classificationTypes.treatment')}
            roleLabel={(role) => tConsumption(`roles.${role}`)}
            onChange={(financialTreatment) =>
              setCreateDraft((current) => ({ ...current, financialTreatment }))
            }
          />
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="classification-type-audit-note">
              {t('classificationTypes.auditNote')}
            </Label>
            <Input
              id="classification-type-audit-note"
              value={createDraft.auditNote}
              disabled={mutation !== null}
              onChange={(event) =>
                setCreateDraft((current) => ({ ...current, auditNote: event.target.value }))
              }
            />
          </div>
        </div>
        <Button
          type="button"
          className="mt-3 min-h-11 max-w-full"
          disabled={mutation !== null || !createDraft.name.trim()}
          onClick={() => void create()}
        >
          {mutation === 'create' ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          {mutation === 'create'
            ? t('classificationTypes.creating')
            : t('classificationTypes.create')}
        </Button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('classificationTypes.catalogTitle')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('classificationTypes.catalogDescription')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground flex min-h-11 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeArchived}
              disabled={loading || mutation !== null}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t('classificationTypes.showArchived')}
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || mutation !== null}
            onClick={() => void load()}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            {t('classificationTypes.refresh')}
          </Button>
        </div>
      </div>

      {loading && !catalog ? (
        <div
          className="text-muted-foreground flex items-center gap-2 py-5 text-sm"
          aria-busy="true"
        >
          <Loader2 size={15} className="animate-spin" />
          {t('classificationTypes.loading')}
        </div>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {definitions.map((entry) => {
            const isEditing = entry.kind === 'custom' && editDraft?.typeId === entry.id
            const customRevisionId = entry.kind === 'custom' ? entry.revisionId : null
            const busy = mutation === entry.id
            return (
              <article
                key={`${entry.kind}:${entry.id}`}
                className="border-border bg-muted/20 min-w-0 rounded-xl border p-4"
              >
                {isEditing && editDraft ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`classification-name-${entry.id}`}>
                        {t('classificationTypes.name')}
                      </Label>
                      <Input
                        id={`classification-name-${entry.id}`}
                        maxLength={100}
                        value={editDraft.name}
                        disabled={busy}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current ? { ...current, name: event.target.value } : current
                          )
                        }
                      />
                    </div>
                    <TreatmentSelect
                      id={`classification-treatment-${entry.id}`}
                      value={editDraft.financialTreatment}
                      treatments={treatments}
                      disabled={busy}
                      label={t('classificationTypes.treatment')}
                      roleLabel={(role) => tConsumption(`roles.${role}`)}
                      onChange={(financialTreatment) =>
                        setEditDraft((current) =>
                          current ? { ...current, financialTreatment } : current
                        )
                      }
                    />
                    <div className="space-y-1.5">
                      <Label htmlFor={`classification-note-${entry.id}`}>
                        {t('classificationTypes.auditNote')}
                      </Label>
                      <Input
                        id={`classification-note-${entry.id}`}
                        value={editDraft.auditNote}
                        disabled={busy}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current ? { ...current, auditNote: event.target.value } : current
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setEditDraft(null)}
                      >
                        <X size={14} />
                        {t('classificationTypes.cancel')}
                      </Button>
                      <Button
                        type="button"
                        disabled={busy || !editDraft.name.trim()}
                        onClick={() => void revise()}
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                        {busy
                          ? t('classificationTypes.saving')
                          : t('classificationTypes.saveRevision')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold break-words">
                          {entry.kind === 'builtin'
                            ? tConsumption(`roles.${entry.role}`)
                            : entry.name}
                        </h4>
                        <p className="text-muted-foreground mt-1 text-[11px] font-semibold tracking-wide uppercase">
                          {entry.kind === 'builtin'
                            ? t('classificationTypes.builtin')
                            : t('classificationTypes.version', { version: entry.version })}
                          {entry.archived ? ` · ${t('classificationTypes.archivedStatus')}` : ''}
                        </p>
                      </div>
                    </div>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-muted-foreground">
                          {t('classificationTypes.treatment')}
                        </dt>
                        <dd className="text-right font-medium">
                          {tConsumption(`roles.${entry.role}`)} ·{' '}
                          {t(`classificationTypes.directions.${entry.direction}`)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-muted-foreground">
                          {t('classificationTypes.reference')}
                        </dt>
                        <dd className="text-right font-medium">
                          {entry.requiresPurchase
                            ? t('classificationTypes.referenceRequired')
                            : t('classificationTypes.referenceNotRequired')}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-muted-foreground mt-3 text-xs leading-relaxed break-words">
                      {tConsumption(`guidance.${entry.role}`, {
                        defaultValue: entry.guidance,
                      })}
                    </p>
                    {entry.kind === 'custom' && !entry.archived && customRevisionId ? (
                      <div className="mt-3 space-y-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`classification-archive-note-${entry.id}`}>
                            {t('classificationTypes.archiveAuditNote')}
                          </Label>
                          <Input
                            id={`classification-archive-note-${entry.id}`}
                            value={archiveNotes[entry.id] ?? ''}
                            disabled={mutation !== null}
                            onChange={(event) =>
                              setArchiveNotes((current) => ({
                                ...current,
                                [entry.id]: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={mutation !== null}
                            onClick={() =>
                              setEditDraft({
                                typeId: entry.id,
                                expectedRevisionId: customRevisionId,
                                name: entry.name,
                                financialTreatment: entry.role,
                                auditNote: '',
                              })
                            }
                          >
                            <Pencil size={14} />
                            {t('classificationTypes.revise')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={mutation !== null}
                            onClick={() => void archive(entry.id, customRevisionId)}
                          >
                            {busy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Archive size={14} />
                            )}
                            {t('classificationTypes.archive')}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TreatmentSelect({
  id,
  value,
  treatments,
  disabled,
  label,
  roleLabel,
  onChange,
}: {
  id: string
  value: ConsumptionRole
  treatments: ClassificationTypeCatalog['definitions']
  disabled: boolean
  label: string
  roleLabel: (role: ConsumptionRole) => string
  onChange: (value: ConsumptionRole) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="native-select min-h-11 w-full max-w-full min-w-0"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const selected = treatments.find((entry) => entry.role === event.target.value)
          if (selected) onChange(selected.role)
        }}
      >
        {treatments.map((entry) => (
          <option key={entry.id} value={entry.role}>
            {roleLabel(entry.role)}
          </option>
        ))}
      </select>
    </div>
  )
}
