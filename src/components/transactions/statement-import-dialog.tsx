import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore } from '@/stores/account-store'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import { importStatementFile } from '@/lib/statement-import'
import { cn } from '@/lib/utils'

interface StatementImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportStep = 'select' | 'preview' | 'importing' | 'done'

export function StatementImportDialog({ open, onOpenChange }: StatementImportDialogProps) {
  const { t } = useTranslation('transactions')
  const { accounts, fetch, fetchError } = useAccountStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>('select')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [accountId, setAccountId] = useState<string>('')
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const resetState = useCallback(() => {
    setStep('select')
    setSelectedFile(null)
    setAccountId('')
    setParsedTransactions([])
    setParseError(null)
    setIsImporting(false)
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetState()
      onOpenChange(open)
    },
    [onOpenChange, resetState]
  )

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setParseError(null)

    try {
      const content = await file.text()
      const parsed = parseStatement(content, file.name)
      setParsedTransactions(parsed)
      if (parsed.length === 0) {
        setParseError('No transactions found in file.')
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file')
      setParsedTransactions([])
    }

    // Reset file input so the same file can be re-selected
    if (e.target) e.target.value = ''
  }, [])

  const canPreview = selectedFile && parsedTransactions.length > 0 && accountId
  const canImport = canPreview && !isImporting

  const handlePreview = useCallback(() => {
    if (canPreview) setStep('preview')
  }, [canPreview])

  const handleImport = useCallback(async () => {
    if (!selectedFile || !accountId) return

    setIsImporting(true)
    setStep('importing')

    try {
      const result = await importStatementFile(selectedFile, accountId)

      if (result.errors.length > 0 && result.imported === 0) {
        toast.error(t('import.error'), {
          description: result.errors[0],
        })
      } else if (result.errors.length > 0) {
        toast.warning(
          t('import.partialError', {
            imported: result.imported,
            errorCount: result.errors.length,
          })
        )
      } else if (result.skipped > 0) {
        toast.success(
          t('import.success', {
            imported: result.imported,
            skipped: result.skipped,
          })
        )
      } else {
        toast.success(
          t('import.successNoSkip', {
            imported: result.imported,
          })
        )
      }

      handleOpenChange(false)
    } catch {
      toast.error(t('import.error'))
    } finally {
      setIsImporting(false)
    }
  }, [selectedFile, accountId, t, handleOpenChange])

  useEffect(() => {
    if (!open || accounts.length > 0) {
      return
    }

    void fetch().catch(() => {})
  }, [open, accounts.length, fetch])

  const activeAccounts = accounts.filter((a) => !a.is_archived)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            {/* Account selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('import.selectAccount')}</label>
              {fetchError && <p className="text-destructive text-sm">{fetchError}</p>}
              {activeAccounts.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('import.noAccounts')}</p>
              ) : (
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('import.selectAccountPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* File picker */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('import.selectFile')}</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,.qfx,.qif"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors',
                  'hover:border-accent/40 hover:bg-accent/5 border-white/10',
                  selectedFile && !parseError && 'border-accent/30 bg-accent/5'
                )}
              >
                {selectedFile ? (
                  <>
                    {parseError ? (
                      <AlertCircle size={24} className="text-destructive" />
                    ) : (
                      <FileText size={24} className="text-accent" />
                    )}
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                    {parseError ? (
                      <span className="text-destructive text-xs">{parseError}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t('import.previewCount', { count: parsedTransactions.length })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-muted-foreground" />
                    <span className="text-muted-foreground text-sm">{t('import.selectFile')}</span>
                    <span className="text-muted-foreground/60 text-xs">
                      {t('import.fileTypes')}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                {t('import.previewCount', { count: parsedTransactions.length })}
              </span>
              <span className="text-muted-foreground text-xs">
                {activeAccounts.find((a) => a.id === accountId)?.name}
              </span>
            </div>
            <ScrollArea className="h-[320px]">
              <div className="space-y-1">
                {/* Table header */}
                <div className="grid grid-cols-[100px_1fr_100px_80px] gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {t('import.date')}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {t('import.descriptionCol')}
                  </span>
                  <span className="text-muted-foreground text-right font-mono text-[10px] uppercase">
                    {t('import.amount')}
                  </span>
                  <span className="text-muted-foreground text-right font-mono text-[10px] uppercase">
                    {t('import.typeCol')}
                  </span>
                </div>
                {parsedTransactions.map((tx, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[100px_1fr_100px_80px] gap-2 rounded-lg px-3 py-2"
                    style={{ backgroundColor: 'rgba(10,10,10,0.6)' }}
                  >
                    <span className="text-muted-foreground font-mono text-xs">{tx.date}</span>
                    <span className="truncate text-sm">{tx.description}</span>
                    <span
                      className={cn(
                        'text-right font-mono text-sm font-medium',
                        tx.type === 'income' ? 'text-success' : 'text-destructive'
                      )}
                    >
                      {tx.type === 'income' ? '+' : '-'}${tx.amount.toFixed(2)}
                    </span>
                    <span className="flex justify-end">
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          tx.type === 'income'
                            ? 'bg-success/10 text-success'
                            : 'bg-destructive/10 text-destructive'
                        )}
                      >
                        {tx.type}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={32} className="text-accent animate-spin" />
            <span className="text-muted-foreground text-sm">{t('import.importing')}</span>
          </div>
        )}

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                {t('import.cancel')}
              </Button>
              <Button onClick={handlePreview} disabled={!canPreview}>
                <CheckCircle2 size={14} />
                {t('import.preview')}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>
                {t('import.cancel')}
              </Button>
              <Button onClick={handleImport} disabled={!canImport}>
                <Upload size={14} />
                {t('import.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
