import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CreditCard,
  FilePlus2,
  Link2,
  Pencil,
  ReceiptText,
  Trash2,
  Unlink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney, fromCentavos, toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { useAccountStore } from '@/stores/account-store'
import {
  createCardStatement,
  deleteCardStatement,
  listCardPaymentLinks,
  listCardStatements,
  previewCreateCardStatement,
  previewDeleteCardStatement,
  previewUnlinkCardPayment,
  previewUpdateCardStatement,
  unlinkCardPayment,
  updateCardStatement,
  type CardPaymentLink,
  type CardStatement,
  type MutationPreview,
  type StatementDraft,
  type StatementUpdate,
} from '@/lib/card-payment-service'
import type { Account } from '@/types/database'
import { LinkCardPaymentDialog, RecordCardPaymentDialog } from './card-payment-dialogs'

interface CardStatementsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account
  onChanged?: () => void | Promise<void>
}

interface StatementEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account
  statement: CardStatement | null
  onCompleted: () => void | Promise<void>
}

function statusVariant(
  status: CardStatement['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'paid') return 'default'
  if (status === 'overdue') return 'destructive'
  if (status === 'partial') return 'secondary'
  return 'outline'
}

function ErrorNotice({ message }: { message: string | null }) {
  return message ? (
    <div
      className="border-destructive/30 bg-destructive/10 text-destructive flex gap-2 rounded-lg border p-3 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  ) : null
}

export function CardStatementsAction({ account }: { account: Account }) {
  const { t } = useTranslation('cardPayments')
  const refreshAccounts = useAccountStore((state) => state.fetch)
  const [open, setOpen] = useState(false)
  if (account.type !== 'credit_card') return null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        onClick={() => setOpen(true)}
      >
        <ReceiptText />
        {t('action')}
      </Button>
      <CardStatementsDialog
        open={open}
        onOpenChange={setOpen}
        account={account}
        onChanged={() => refreshAccounts()}
      />
    </>
  )
}

export function StatementEditorDialog({
  open,
  onOpenChange,
  account,
  statement,
  onCompleted,
}: StatementEditorDialogProps) {
  const { t } = useTranslation('cardPayments')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [balance, setBalance] = useState('')
  const [minimum, setMinimum] = useState('0.00')
  const [paid, setPaid] = useState('0.00')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<MutationPreview<CardStatement> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStartDate(statement?.statementStartDate ?? '')
    setEndDate(statement?.statementEndDate ?? '')
    setDueDate(statement?.dueDate ?? '')
    setBalance(statement ? fromCentavos(statement.statementBalance).toFixed(2) : '')
    setMinimum(statement ? fromCentavos(statement.minimumPayment).toFixed(2) : '0.00')
    setPaid(statement ? fromCentavos(statement.paidAmount).toFixed(2) : '0.00')
    setNote(statement?.note ?? '')
    setPreview(null)
    setError(null)
  }, [open, statement])

  const draft = (): StatementDraft => ({
    statementStartDate: startDate || null,
    statementEndDate: endDate,
    dueDate,
    statementBalance: toCentavos(Number(balance)),
    minimumPayment: toCentavos(Number(minimum)),
    paidAmount: toCentavos(Number(paid)),
    source: 'frontend-card-statements',
    note,
  })
  const patch = (): StatementUpdate => draft()

  const review = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      setPreview(
        statement
          ? await previewUpdateCardStatement(statement.id, patch())
          : await previewCreateCardStatement(account.id, draft())
      )
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    setError(null)
    setLoading(true)
    try {
      if (statement) await updateCardStatement(statement.id, patch(), preview.revision)
      else await createCardStatement(account.id, draft(), preview.revision)
      await onCompleted()
      onOpenChange(false)
    } catch (reason) {
      setPreview(null)
      setError(getErrorMessage(reason, t('stale')))
    } finally {
      setLoading(false)
    }
  }

  const invalidate = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPreview(null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{statement ? t('editor.editTitle') : t('editor.createTitle')}</DialogTitle>
          <DialogDescription>
            {t('editor.description', { card: account.name, currency: account.currency })}
          </DialogDescription>
        </DialogHeader>
        <ErrorNotice message={error} />
        <form className="space-y-4" onSubmit={review}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="statement-start">{t('fields.startDate')}</Label>
              <Input
                className="h-11"
                id="statement-start"
                type="date"
                value={startDate}
                onChange={(event) => invalidate(setStartDate)(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="statement-end">{t('fields.endDate')}</Label>
              <Input
                className="h-11"
                id="statement-end"
                type="date"
                value={endDate}
                onChange={(event) => invalidate(setEndDate)(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="statement-due">{t('fields.dueDate')}</Label>
              <Input
                className="h-11"
                id="statement-due"
                type="date"
                value={dueDate}
                onChange={(event) => invalidate(setDueDate)(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="statement-balance">{t('fields.balance')}</Label>
              <Input
                className="h-11"
                id="statement-balance"
                type="number"
                min="0"
                step="0.01"
                value={balance}
                onChange={(event) => invalidate(setBalance)(event.target.value)}
                required
              />
              <p className="text-muted-foreground text-xs">{account.currency}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="statement-minimum">{t('fields.minimum')}</Label>
              <Input
                className="h-11"
                id="statement-minimum"
                type="number"
                min="0"
                step="0.01"
                value={minimum}
                onChange={(event) => invalidate(setMinimum)(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="statement-paid">{t('fields.paid')}</Label>
              <Input
                className="h-11"
                id="statement-paid"
                type="number"
                min="0"
                step="0.01"
                value={paid}
                onChange={(event) => invalidate(setPaid)(event.target.value)}
                required
              />
              <p className="text-muted-foreground text-xs">
                {statement?.linkedPaidAmount
                  ? t('editor.linkFloor', {
                      amount: formatMoney(statement.linkedPaidAmount, statement.currency),
                    })
                  : t('editor.baselineHelp')}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="statement-note">{t('fields.note')}</Label>
            <Input
              className="h-11"
              id="statement-note"
              value={note}
              onChange={(event) => invalidate(setNote)(event.target.value)}
              maxLength={1000}
            />
          </div>
          {preview?.after ? (
            <div
              className="border-primary/30 bg-accent-muted rounded-lg border p-4"
              aria-label={t('review.title')}
            >
              <p className="font-semibold">{t('review.title')}</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <span className="text-muted-foreground">{t('fields.balance')}</span>
                <span className="text-right font-medium tabular-nums">
                  {formatMoney(preview.after.statementBalance, preview.after.currency)}
                </span>
                <span className="text-muted-foreground">{t('fields.paid')}</span>
                <span className="text-right font-medium tabular-nums">
                  {formatMoney(preview.after.paidAmount, preview.after.currency)}
                </span>
              </div>
              {preview.after.legacyOverpaid ? (
                <p className="text-warning mt-2 text-xs">{t('legacyOverpaid')}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={loading}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            {preview ? (
              <Button type="button" className="min-h-11" disabled={loading} onClick={apply}>
                {loading ? t('actions.saving') : t('actions.confirm')}
              </Button>
            ) : (
              <Button type="submit" className="min-h-11" disabled={loading}>
                {loading ? t('actions.loading') : t('actions.review')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CardStatementsDialog({
  open,
  onOpenChange,
  account,
  onChanged,
}: CardStatementsDialogProps) {
  const { t } = useTranslation('cardPayments')
  const [statements, setStatements] = useState<CardStatement[]>([])
  const [history, setHistory] = useState<Record<string, CardPaymentLink[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CardStatement | 'new' | null>(null)
  const [linking, setLinking] = useState<CardStatement | null>(null)
  const [paying, setPaying] = useState<CardStatement | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'delete'; statement: CardStatement; preview: MutationPreview<null> }
    | {
        kind: 'unlink'
        statement: CardStatement
        link: CardPaymentLink
        preview: MutationPreview<CardStatement>
      }
    | null
  >(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listCardStatements(account.id)
      const entries = await Promise.all(
        rows.map(
          async (statement) =>
            [statement.id, await listCardPaymentLinks(statement.id, 'all')] as const
        )
      )
      setStatements(rows)
      setHistory(Object.fromEntries(entries))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [account.id])

  const completed = useCallback(async () => {
    await refresh()
    await onChanged?.()
  }, [onChanged, refresh])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const requestDelete = async (statement: CardStatement) => {
    setError(null)
    try {
      setConfirm({
        kind: 'delete',
        statement,
        preview: await previewDeleteCardStatement(statement.id),
      })
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  const requestUnlink = async (statement: CardStatement, link: CardPaymentLink) => {
    setError(null)
    try {
      setConfirm({
        kind: 'unlink',
        statement,
        link,
        preview: await previewUnlinkCardPayment(link.id),
      })
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  const applyConfirm = async () => {
    if (!confirm) return
    setLoading(true)
    setError(null)
    try {
      if (confirm.kind === 'delete') {
        await deleteCardStatement(
          confirm.statement.id,
          confirm.preview.revision,
          'frontend-card-statements',
          t('audit.deleteNote')
        )
      } else {
        await unlinkCardPayment(
          confirm.link.id,
          confirm.preview.revision,
          'frontend-card-statements',
          t('audit.unlinkNote')
        )
      }
      setConfirm(null)
      await completed()
    } catch (reason) {
      setConfirm(null)
      setError(getErrorMessage(reason, t('stale')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('title', { card: account.name })}</DialogTitle>
            <DialogDescription>
              {t('description', { currency: account.currency })}
            </DialogDescription>
          </DialogHeader>
          <ErrorNotice message={error} />
          <div className="flex justify-end">
            <Button className="min-h-11" onClick={() => setEditing('new')}>
              <FilePlus2 />
              {t('create')}
            </Button>
          </div>
          {loading && statements.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">{t('actions.loading')}</p>
          ) : statements.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed px-6 py-10 text-center">
              <ReceiptText className="text-muted-foreground mx-auto size-7" />
              <h3 className="mt-3 font-semibold">{t('empty.title')}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{t('empty.description')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {statements.map((statement) => {
                const allLinks = history[statement.id] ?? []
                const voided = allLinks.filter((link) => link.voidedAt)
                return (
                  <article key={statement.id} className="border-border rounded-xl border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{statement.statementEndDate}</h3>
                          <Badge variant={statusVariant(statement.status)}>
                            {t(`status.${statement.status}`)}
                          </Badge>
                          {statement.legacyOverpaid ? (
                            <Badge variant="outline" className="text-warning">
                              {t('legacyBadge')}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t('due', { date: statement.dueDate })}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-11 sm:min-h-9"
                          onClick={() => setPaying(statement)}
                        >
                          <CreditCard />
                          {t('payment.action')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-11 sm:min-h-9"
                          onClick={() => setLinking(statement)}
                        >
                          <Link2 />
                          {t('link.action')}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('actions.edit')}
                          onClick={() => setEditing(statement)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('actions.delete')}
                          onClick={() => void requestDelete(statement)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="border-border mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
                      <div>
                        <p className="text-muted-foreground text-xs">{t('fields.balance')}</p>
                        <p className="mt-1 font-semibold tabular-nums">
                          {formatMoney(statement.statementBalance, statement.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{t('fields.paid')}</p>
                        <p className="mt-1 font-semibold tabular-nums">
                          {formatMoney(statement.paidAmount, statement.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{t('baseline')}</p>
                        <p className="mt-1 font-medium tabular-nums">
                          {formatMoney(statement.unattributedPaidAmount, statement.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{t('linked')}</p>
                        <p className="mt-1 font-medium tabular-nums">
                          {formatMoney(statement.linkedPaidAmount, statement.currency)}
                        </p>
                      </div>
                    </div>
                    {statement.legacyOverpaid ? (
                      <p className="border-warning/30 bg-warning/10 text-warning mt-3 rounded-lg border p-3 text-xs">
                        {t('legacyOverpaid')}
                      </p>
                    ) : null}
                    {statement.activeLinks.length ? (
                      <div className="mt-4 space-y-2">
                        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                          {t('evidenceTitle')}
                        </p>
                        {statement.activeLinks.map((link) => (
                          <div
                            key={link.id}
                            className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg p-3 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {link.transactionDescription ?? link.originalTransactionId}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {link.transactionDate} · {t(`mode.${link.mode}`)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="font-semibold tabular-nums">
                                {formatMoney(link.amount, statement.currency)}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="min-h-11 min-w-11"
                                aria-label={t('actions.unlink')}
                                onClick={() => void requestUnlink(statement, link)}
                              >
                                <Unlink />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {voided.length ? (
                      <details className="mt-3 text-sm">
                        <summary className="text-muted-foreground min-h-11 cursor-pointer py-3">
                          {t('history', { count: voided.length })}
                        </summary>
                        <div className="space-y-2">
                          {voided.map((link) => (
                            <p
                              key={link.id}
                              className="text-muted-foreground flex justify-between gap-3 text-xs"
                            >
                              <span>{link.originalTransactionId}</span>
                              <span className="tabular-nums">
                                {formatMoney(link.amount, statement.currency)} · {t('voided')}
                              </span>
                            </p>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <StatementEditorDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        account={account}
        statement={editing === 'new' ? null : editing}
        onCompleted={completed}
      />
      {linking ? (
        <LinkCardPaymentDialog
          open
          account={account}
          statement={linking}
          onOpenChange={(next) => !next && setLinking(null)}
          onCompleted={completed}
        />
      ) : null}
      {paying ? (
        <RecordCardPaymentDialog
          open
          account={account}
          statement={paying}
          onOpenChange={(next) => !next && setPaying(null)}
          onCompleted={completed}
        />
      ) : null}
      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => !next && !loading && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'delete' ? t('confirm.deleteTitle') : t('confirm.unlinkTitle')}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? t('confirm.deleteDescription')
                : t('confirm.unlinkDescription')}
            </DialogDescription>
          </DialogHeader>
          {confirm?.kind === 'unlink' ? (
            <p className="bg-muted/40 rounded-lg p-3 text-sm tabular-nums">
              {formatMoney(confirm.link.amount, confirm.statement.currency)} ·{' '}
              {t(`mode.${confirm.link.mode}`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={loading}
              onClick={() => setConfirm(null)}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
              className="min-h-11"
              disabled={loading}
              onClick={() => void applyConfirm()}
            >
              {loading ? t('actions.saving') : t('actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
