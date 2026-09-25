import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TransactionForm, type TransactionFormValues, type SplitRowData } from './transaction-form'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { getSplits } from '@/lib/split-service'
import { toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { getTransactionById, type TransactionPageRow } from '@/lib/transaction-query'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ConsumptionClassificationDialog } from './consumption-classification-dialog'
import { TransactionInspection } from './transaction-inspection'
import { transactionProtection } from './transaction-inspection-eligibility'

type EditLoadState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

export function TransactionDialog() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [classificationOpen, setClassificationOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [requestedId, setRequestedId] = useState<string | null | undefined>(undefined)
  const [editLoadState, setEditLoadState] = useState<EditLoadState>('idle')
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [loadedTransaction, setLoadedTransaction] = useState<TransactionPageRow | null>(null)
  const [loadedSplits, setLoadedSplits] = useState<SplitRowData[]>([])
  const lookupSequence = useRef(0)
  const identityChanged = useRef(false)
  const focusAfterIdentity = useRef(false)
  const classificationChanged = useRef(false)
  const committedClose = useRef(false)
  const protectLoadedForm = useRef(false)
  const loadedTransactionId = useRef<string | undefined>(undefined)
  const currentSession = useRef<{ open: boolean; id: string | null }>({ open: false, id: null })
  const {
    transactionDialogOpen,
    editingTransactionId,
    closeTransactionDialog,
    openTransactionDialog,
  } = useUIStore()
  const { add, addWithSplits, update, correctMetadata, remove } = useTransactionStore()
  // Keep the current form mounted until a dirty session explicitly discards changes.
  useEffect(() => {
    if (!transactionDialogOpen) {
      if (
        !committedClose.current &&
        sessionId !== undefined &&
        (isDirty || isLoading || deleteOpen || classificationOpen || identityOpen)
      ) {
        setRequestedId(undefined)
        openTransactionDialog(sessionId === 'new' ? undefined : sessionId)
        if (isDirty && !isLoading && !deleteOpen && !classificationOpen && !identityOpen)
          setConfirmDiscardOpen(true)
        return
      }
      committedClose.current = false
      setSessionId(undefined)
      setRequestedId(undefined)
      return
    }
    if (sessionId === (editingTransactionId ?? 'new')) return
    if (
      sessionId !== undefined &&
      (isDirty || isLoading || deleteOpen || classificationOpen || identityOpen)
    ) {
      const canDiscard = !isLoading && !deleteOpen && !classificationOpen && !identityOpen
      setRequestedId(canDiscard ? editingTransactionId : undefined)
      openTransactionDialog(sessionId === 'new' ? undefined : sessionId)
      if (canDiscard) setConfirmDiscardOpen(true)
      return
    }
    setIsDirty(false)
    setSessionId(editingTransactionId ?? 'new')
  }, [
    identityOpen,
    transactionDialogOpen,
    editingTransactionId,
    sessionId,
    isDirty,
    isLoading,
    deleteOpen,
    classificationOpen,
    openTransactionDialog,
  ])
  const activeEditingId =
    sessionId !== undefined &&
    (isDirty || isLoading || deleteOpen || classificationOpen || identityOpen)
      ? sessionId === 'new'
        ? null
        : sessionId
      : editingTransactionId
  protectLoadedForm.current =
    isDirty || isLoading || deleteOpen || classificationOpen || identityOpen
  loadedTransactionId.current = loadedTransaction?.id
  currentSession.current = { open: transactionDialogOpen, id: activeEditingId }
  const isEditing = !!activeEditingId

  const loadEditingTransaction = useCallback(async (id: string, refresh = false) => {
    const sequence = ++lookupSequence.current
    const isCurrent = () =>
      sequence === lookupSequence.current &&
      currentSession.current.open &&
      currentSession.current.id === id
    if (!refresh) {
      setEditLoadState('loading')
      setEditLoadError(null)
      setLoadedTransaction(null)
      setLoadedSplits([])
    }
    try {
      const transaction = await getTransactionById(id)
      if (!isCurrent()) return
      if (!transaction) {
        setEditLoadState('not-found')
        return
      }
      const splits = transaction.has_splits ? await getSplits(id) : []
      if (!isCurrent()) return
      setLoadedSplits(
        splits.map((split) => ({
          categoryId: split.category_id ?? '',
          subcategoryId: split.subcategory_id,
          amount: (split.amount / 100).toFixed(2),
          notes: split.notes ?? '',
        }))
      )
      setLoadedTransaction(transaction)
      setEditLoadState('ready')
      if (focusAfterIdentity.current) {
        focusAfterIdentity.current = false
        setTimeout(() => {
          if (isCurrent())
            document
              .querySelector<HTMLElement>(
                '[data-transaction-details-summary], [data-transaction-details-readonly]'
              )
              ?.focus()
        }, 0)
      }
    } catch (error) {
      if (!isCurrent()) return
      setEditLoadError(getErrorMessage(error))
      setEditLoadState('error')
    }
  }, [])

  useEffect(() => {
    if (!transactionDialogOpen || !editingTransactionId || sessionId !== editingTransactionId) {
      // A rejected close/switch must not unmount the dirty form while the store reverts.
      if (sessionId !== undefined && protectLoadedForm.current) return
      lookupSequence.current += 1
      setLoadedTransaction(null)
      setEditLoadError(null)
      setEditLoadState('idle')
      return
    }
    // The store may briefly request another row before restoring a blocked dirty switch.
    // Do not reset the still-mounted form when its original ID returns.
    if (protectLoadedForm.current && loadedTransactionId.current === editingTransactionId) return
    void loadEditingTransaction(editingTransactionId)
  }, [editingTransactionId, loadEditingTransaction, transactionDialogOpen, sessionId])

  const handleSubmit = async (data: TransactionFormValues, splits?: SplitRowData[]) => {
    if (isEditing && (!activeEditingId || editLoadState !== 'ready' || !loadedTransaction)) return

    setIsLoading(true)
    try {
      if (isEditing && activeEditingId) {
        const replacement = splits?.map((split) => ({
          categoryId: split.categoryId,
          subcategoryId: split.subcategoryId,
          amount: toCentavos(Number(split.amount)),
          notes: split.notes || null,
        }))
        const splitsChanged =
          splits !== undefined && JSON.stringify(splits) !== JSON.stringify(loadedSplits)
        if (
          splitsChanged ||
          loadedTransaction?.has_splits ||
          loadedTransaction?.is_finalized_statement ||
          loadedTransaction?.finalization_id
        ) {
          if (
            !loadedTransaction ||
            toCentavos(data.amount) !== loadedTransaction.amount ||
            data.type !== loadedTransaction.type ||
            data.accountId !== loadedTransaction.account_id ||
            data.currency !== loadedTransaction.currency ||
            data.date !== loadedTransaction.date ||
            data.transferToAccountId !== loadedTransaction.transfer_to_account_id
          )
            throw new Error(t('correction.financialLocked'))
          await correctMetadata(
            activeEditingId,
            {
              description: data.description,
              category_id: data.categoryId,
              subcategory_id: data.subcategoryId,
              notes: data.notes,
              reporting_treatment: data.reportingTreatment,
            },
            splitsChanged ? replacement : undefined
          )
        } else {
          await update(activeEditingId, data)
        }
        invalidateTransactionPage('edit')
        toast.success(t('toast.updated'))
      } else if (splits && splits.length >= 2) {
        await addWithSplits(
          data,
          splits.map((split) => ({
            categoryId: split.categoryId,
            amount: toCentavos(parseFloat(split.amount)),
            notes: split.notes || null,
          }))
        )
        invalidateTransactionPage('add')
        toast.success(t('toast.created'))
      } else {
        await add(data)
        invalidateTransactionPage('add')
        toast.success(t('toast.created'))
      }
      setIsDirty(false)
      committedClose.current = true
      closeTransactionDialog()
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRequestClose = () => {
    if (isLoading || deleteOpen || classificationOpen || identityOpen) return
    setRequestedId(undefined)
    if (isDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    closeTransactionDialog()
  }

  const handleDelete = async () => {
    if (!activeEditingId || isLoading || isDirty) return
    setIsLoading(true)
    try {
      await remove(activeEditingId)
      invalidateTransactionPage('delete')
      toast.success(t('toast.deleted'))
      setDeleteOpen(false)
      committedClose.current = true
      closeTransactionDialog()
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsLoading(false)
    }
  }

  const refreshAfterIdentity = () => {
    if (!identityChanged.current) return
    identityChanged.current = false
    focusAfterIdentity.current = true
    // The nested dialog has closed; keep its launcher mounted through focus restoration.
    setTimeout(() => {
      const inspection = document.querySelector<HTMLElement>(
        '[data-transaction-details-summary], [data-transaction-details-readonly]'
      )
      inspection?.focus()
      refreshInspection()
    }, 0)
  }

  const refreshInspection = () => {
    if (
      !activeEditingId ||
      isDirty ||
      !currentSession.current.open ||
      currentSession.current.id !== activeEditingId
    )
      return
    invalidateTransactionPage('review')
    void loadEditingTransaction(activeEditingId, true)
  }

  const protectedRow = loadedTransaction && transactionProtection(loadedTransaction)
  const canRenderEditForm =
    !isEditing || (editLoadState === 'ready' && loadedTransaction?.id === activeEditingId)

  return (
    <>
      <Dialog open={transactionDialogOpen} onOpenChange={(open) => !open && handleRequestClose()}>
        <DialogContent className="border-border bg-surface max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words">
              {protectedRow
                ? t('detail.readOnlyTitle')
                : isEditing
                  ? t('editTransaction')
                  : t('addTransaction')}
            </DialogTitle>
            <DialogDescription>
              {protectedRow
                ? t('dialog.readOnlyDescription')
                : isEditing
                  ? t('dialog.editDescription')
                  : t('dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>

          {isEditing && editLoadState === 'loading' && (
            <div className="space-y-4 py-2" aria-label={t('dialog.loading')}>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {isEditing && editLoadState === 'not-found' && (
            <div className="border-border bg-muted/40 rounded-lg border p-5 text-center">
              <p className="font-medium">{t('dialog.notFound')}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('dialog.notFoundDescription')}
              </p>
            </div>
          )}
          {isEditing && editLoadState === 'error' && editingTransactionId && (
            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-5 text-center">
              <p className="font-medium">{t('dialog.loadError')}</p>
              <p className="text-muted-foreground mt-1 text-sm">{editLoadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void loadEditingTransaction(editingTransactionId)}
              >
                {t('dialog.retry')}
              </Button>
            </div>
          )}
          {canRenderEditForm && !protectedRow && (
            <TransactionForm
              key={`form-${activeEditingId || 'new'}`}
              transaction={isEditing ? (loadedTransaction ?? undefined) : undefined}
              initialSplits={isEditing ? loadedSplits : undefined}
              metadataOnly={
                isEditing &&
                !!(
                  loadedTransaction?.has_splits ||
                  loadedTransaction?.is_finalized_statement ||
                  loadedTransaction?.finalization_id
                )
              }
              onSubmit={handleSubmit}
              isLoading={isLoading}
              onDirtyChange={setIsDirty}
            />
          )}
          {isEditing && editLoadState === 'ready' && loadedTransaction && (
            <TransactionInspection
              key={`inspection-${loadedTransaction.id}`}
              transaction={loadedTransaction}
              onClassify={() => setClassificationOpen(true)}
              onIdentityChanged={() => {
                identityChanged.current = true
                invalidateTransactionPage('review')
              }}
              onIdentityClosed={refreshAfterIdentity}
              onIdentityOpenChange={setIdentityOpen}
              onDelete={() => setDeleteOpen(true)}
              actionsDisabled={
                isLoading || isDirty || deleteOpen || classificationOpen || identityOpen
              }
              dirty={isDirty}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConsumptionClassificationDialog
        transactionId={classificationOpen ? activeEditingId : null}
        open={classificationOpen}
        onOpenChange={(open) => {
          setClassificationOpen(open)
          if (!open && classificationChanged.current) {
            classificationChanged.current = false
            setTimeout(refreshInspection, 0)
          }
        }}
        onChanged={() => {
          classificationChanged.current = true
          invalidateTransactionPage('review')
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!isLoading) setDeleteOpen(open)
        }}
        title={t('deleteTransaction')}
        description={t('deleteConfirm')}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        variant="destructive"
        isLoading={isLoading}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={(open) => {
          setConfirmDiscardOpen(open)
          if (!open) setRequestedId(undefined)
        }}
        title={t('dialog.discardTitle')}
        description={t('dialog.discardDescription')}
        confirmLabel={t('dialog.discard')}
        cancelLabel={tCommon('actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          setConfirmDiscardOpen(false)
          setIsDirty(false)
          if (requestedId !== undefined) {
            const next = requestedId
            setRequestedId(undefined)
            setSessionId(next ?? 'new')
            openTransactionDialog(next ?? undefined)
          } else closeTransactionDialog()
        }}
      />
    </>
  )
}
