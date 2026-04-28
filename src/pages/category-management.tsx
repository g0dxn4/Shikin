import { useEffect, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Pencil,
  Trash2,
  Tag,
  Utensils,
  Car,
  Home,
  Tv,
  HeartPulse,
  ShoppingBag,
  GraduationCap,
  Zap,
  Repeat,
  MoreHorizontal,
  Banknote,
  Briefcase,
  TrendingUp,
  PlusCircle,
  ArrowRightLeft,
  LayoutGrid,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCategoryStore } from '@/stores/category-store'
import type { TransactionType } from '@/types/common'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  tag: Tag,
  utensils: Utensils,
  car: Car,
  home: Home,
  tv: Tv,
  'heart-pulse': HeartPulse,
  'shopping-bag': ShoppingBag,
  'graduation-cap': GraduationCap,
  zap: Zap,
  repeat: Repeat,
  'more-horizontal': MoreHorizontal,
  banknote: Banknote,
  briefcase: Briefcase,
  'trending-up': TrendingUp,
  'plus-circle': PlusCircle,
  'arrow-right-left': ArrowRightLeft,
}

const DEFAULT_ICONS = [
  'tag',
  'utensils',
  'car',
  'home',
  'tv',
  'heart-pulse',
  'shopping-bag',
  'graduation-cap',
  'zap',
  'repeat',
  'banknote',
  'briefcase',
  'trending-up',
]

const COLOR_OPTIONS = [
  '#22c55e',
  '#f59e0b',
  '#3b82f6',
  '#7C5CFF',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#71717a',
  '#f97316',
  '#8b5cf6',
  '#a855f7',
  '#10b981',
  '#14b8a6',
  '#059669',
  '#6366f1',
]

const TYPE_OPTIONS: TransactionType[] = ['expense', 'income', 'transfer']

const DEFAULT_CATEGORY_FORM = {
  name: '',
  type: 'expense' as TransactionType,
  color: '#7C5CFF',
  icon: 'tag',
}

const COLOR_LABELS: Record<string, string> = {
  '#22c55e': 'Green',
  '#f59e0b': 'Amber',
  '#3b82f6': 'Blue',
  '#7C5CFF': 'Purple',
  '#ef4444': 'Red',
  '#06b6d4': 'Cyan',
  '#ec4899': 'Pink',
  '#71717a': 'Gray',
  '#f97316': 'Orange',
  '#8b5cf6': 'Violet',
  '#a855f7': 'Seeded purple',
  '#10b981': 'Emerald',
  '#14b8a6': 'Teal',
  '#059669': 'Dark emerald',
  '#6366f1': 'Indigo',
}

const ICON_LABELS: Record<string, string> = {
  tag: 'Tag',
  utensils: 'Food',
  car: 'Transport',
  home: 'Home',
  tv: 'Entertainment',
  'heart-pulse': 'Health',
  'shopping-bag': 'Shopping',
  'graduation-cap': 'Education',
  zap: 'Utilities',
  repeat: 'Recurring',
  banknote: 'Money',
  briefcase: 'Work',
  'trending-up': 'Investing',
}

function CategoryIcon({ name, size = 14 }: { name: string | null; size?: number }) {
  const Icon = name ? ICON_MAP[name] : null
  if (Icon) return <Icon size={size} />
  return <Tag size={size} />
}

export function CategoryManagement() {
  const { t } = useTranslation(['categories', 'common'])
  const { categories, isLoading, fetchError, fetch, add, update, remove } = useCategoryStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveAttempted, setSaveAttempted] = useState(false)

  const [formName, setFormName] = useState(DEFAULT_CATEGORY_FORM.name)
  const [formType, setFormType] = useState<TransactionType>(DEFAULT_CATEGORY_FORM.type)
  const [formColor, setFormColor] = useState(DEFAULT_CATEGORY_FORM.color)
  const [formIcon, setFormIcon] = useState(DEFAULT_CATEGORY_FORM.icon)

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const selected = selectedId ? categories.find((c) => c.id === selectedId) : null

  useEffect(() => {
    if (selectedId && !isAdding && !isLoading && !selected) {
      setSelectedId(null)
    }
  }, [selectedId, isAdding, isLoading, selected])

  const startAdd = () => {
    setSelectedId(null)
    setIsAdding(true)
    setFormName(DEFAULT_CATEGORY_FORM.name)
    setFormType(DEFAULT_CATEGORY_FORM.type)
    setFormColor(DEFAULT_CATEGORY_FORM.color)
    setFormIcon(DEFAULT_CATEGORY_FORM.icon)
    setSaveAttempted(false)
  }

  const startEdit = (id: string) => {
    const category = categories.find((c) => c.id === id)
    if (category) {
      setFormName(category.name)
      setFormType(category.type)
      setFormColor(category.color || DEFAULT_CATEGORY_FORM.color)
      setFormIcon(category.icon || DEFAULT_CATEGORY_FORM.icon)
      setSaveAttempted(false)
    }
    setIsAdding(false)
    setSelectedId(id)
  }

  const handleSave = async () => {
    setSaveAttempted(true)
    const name = formName.trim()
    if (!name) {
      toast.error(t('toast.nameRequired'))
      return
    }
    setIsSaving(true)
    try {
      if (isAdding) {
        await add({ name, type: formType, color: formColor, icon: formIcon })
        toast.success(t('toast.created'))
        setIsAdding(false)
      } else if (selectedId) {
        await update(selectedId, { name, type: formType, color: formColor, icon: formIcon })
        toast.success(t('toast.updated'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      if (selectedId === deleteId) {
        setSelectedId(null)
        setIsAdding(false)
      }
      setDeleteId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.deleteFailed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const showForm = isAdding || !!selectedId
  const hasInitialLoadError = !!fetchError && categories.length === 0
  const showNameError = saveAttempted && !formName.trim()

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button onClick={startAdd}>
            <Plus size={16} />
            {t('addCategory')}
          </Button>
        }
      />

      <ErrorBanner
        title={t('loadError')}
        message={!hasInitialLoadError ? fetchError : null}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <CategorySkeleton />
      ) : hasInitialLoadError ? (
        <ErrorState
          title={t('loadError')}
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : categories.length === 0 && !isAdding ? (
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
            <LayoutGrid size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={startAdd}>
            <Plus size={16} />
            {t('addCategory')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
          {/* Category List */}
          <div className="liquid-card overflow-hidden p-5">
            <div className="text-muted-foreground mb-2 hidden grid-cols-[1fr_80px_80px] gap-4 px-2 font-mono text-[10px] tracking-wider uppercase md:grid">
              <span>{t('table.category')}</span>
              <span className="text-right">{t('table.type')}</span>
              <span className="text-right">{t('table.actions')}</span>
            </div>

            <div className="space-y-1" role="list" aria-label={t('title')}>
              {categories.map((cat) => {
                const isSelected = cat.id === selectedId && !isAdding
                return (
                  <div
                    key={cat.id}
                    role="listitem"
                    aria-current={isSelected ? 'true' : undefined}
                    className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-lg px-2 py-2.5 text-left transition-colors md:grid-cols-[1fr_80px_80px] ${
                      isSelected ? 'bg-accent/5' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => startEdit(cat.id)}
                      className="focus-visible:ring-ring/50 -mx-1 flex items-center gap-2 rounded-md px-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: `${cat.color || '#7C5CFF'}20`,
                          color: cat.color || '#7C5CFF',
                        }}
                      >
                        <CategoryIcon name={cat.icon} />
                      </div>
                      <span className="text-sm font-medium">{cat.name}</span>
                    </button>

                    <span className="hidden text-right md:block">
                      <Badge variant="secondary" className="text-[10px]">
                        {t(`types.${cat.type}`)}
                      </Badge>
                    </span>

                    <div className="flex justify-end gap-0.5">
                      <button
                        type="button"
                        aria-label={t('actions.edit', { name: cat.name })}
                        onClick={(event) => {
                          event.stopPropagation()
                          startEdit(cat.id)
                        }}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-7 w-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('actions.delete', { name: cat.name })}
                        onClick={(event) => {
                          event.stopPropagation()
                          setDeleteId(cat.id)
                        }}
                        className="text-muted-foreground hover:text-destructive focus-visible:ring-ring/50 flex h-7 w-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail / Form Panel */}
          <div className="liquid-card space-y-6 p-5">
            {showForm ? (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${formColor}20`,
                      color: formColor,
                    }}
                  >
                    <CategoryIcon name={formIcon} size={16} />
                  </div>
                  <h3 className="font-heading flex-1 text-lg font-semibold">
                    {isAdding ? t('newCategory') : selected?.name}
                  </h3>
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <label
                    htmlFor="category-name"
                    className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
                  >
                    {t('form.name')}
                  </label>
                  <Input
                    id="category-name"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value)
                      if (saveAttempted) setSaveAttempted(false)
                    }}
                    onBlur={() => {
                      if (!formName.trim()) setSaveAttempted(true)
                    }}
                    placeholder={t('form.namePlaceholder')}
                    aria-invalid={showNameError}
                    aria-describedby={showNameError ? 'category-name-error' : undefined}
                  />
                  {showNameError && (
                    <p id="category-name-error" role="alert" className="text-destructive text-xs">
                      {t('form.nameRequired')}
                    </p>
                  )}
                </div>

                {/* Type */}
                <div className="space-y-2">
                  <label
                    htmlFor="category-type"
                    className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
                  >
                    {t('form.type')}
                  </label>
                  <Select
                    value={formType}
                    onValueChange={(value) => setFormType(value as TransactionType)}
                  >
                    <SelectTrigger id="category-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`types.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Color picker */}
                <div className="space-y-2">
                  <label
                    id="category-color-label"
                    className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
                  >
                    {t('form.color')}
                  </label>
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-labelledby="category-color-label"
                  >
                    {COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={t('actions.selectColor', {
                          color: COLOR_LABELS[color] ?? color,
                        })}
                        aria-pressed={formColor === color}
                        onClick={() => setFormColor(color)}
                        className={`focus-visible:ring-ring focus-visible:ring-offset-background h-8 w-8 rounded-full transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 ${
                          formColor === color
                            ? 'ring-ring ring-offset-background ring-2 ring-offset-2'
                            : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Icon picker */}
                <div className="space-y-2">
                  <label
                    id="category-icon-label"
                    className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
                  >
                    {t('form.icon')}
                  </label>
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-labelledby="category-icon-label"
                  >
                    {DEFAULT_ICONS.map((iconName) => (
                      <button
                        key={iconName}
                        type="button"
                        aria-label={t('actions.selectIcon', {
                          icon: ICON_LABELS[iconName] ?? iconName,
                        })}
                        aria-pressed={formIcon === iconName}
                        onClick={() => setFormIcon(iconName)}
                        className={`focus-visible:ring-ring focus-visible:ring-offset-background flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
                          formIcon === iconName
                            ? 'text-foreground bg-white/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                        }`}
                      >
                        <CategoryIcon name={iconName} size={14} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    className="flex-1"
                    onClick={handleSave}
                    disabled={isSaving || !formName.trim()}
                  >
                    {isSaving
                      ? t('common:actions.saving')
                      : isAdding
                        ? t('createCategory')
                        : t('saveChanges')}
                  </Button>
                  {isAdding && (
                    <Button variant="outline" onClick={() => setIsAdding(false)}>
                      {t('common:actions.cancel')}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-muted-foreground mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04]">
                  <Pencil size={18} />
                </div>
                <p className="text-muted-foreground text-sm">{t('selectPrompt')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteCategory')}
          description={t('deleteDescription')}
          confirmLabel={t('common:actions.delete')}
          cancelLabel={t('common:actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}

function CategorySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
      <div className="liquid-card space-y-3 p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <div className="ml-auto flex gap-1">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          </div>
        ))}
      </div>
      <div className="liquid-card space-y-6 p-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  )
}
