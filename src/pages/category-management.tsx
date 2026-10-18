import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
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
  Coffee,
  Plane,
  Gift,
  Shield,
  Wrench,
  Fuel,
  Bus,
  Gamepad2,
  Shirt,
  Baby,
  PawPrint,
  BookOpen,
  Smartphone,
  Wifi,
  Landmark,
  Receipt,
  Wallet,
  CreditCard,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  coffee: Coffee,
  plane: Plane,
  gift: Gift,
  shield: Shield,
  wrench: Wrench,
  fuel: Fuel,
  bus: Bus,
  'gamepad-2': Gamepad2,
  shirt: Shirt,
  baby: Baby,
  'paw-print': PawPrint,
  'book-open': BookOpen,
  smartphone: Smartphone,
  wifi: Wifi,
  landmark: Landmark,
  receipt: Receipt,
  wallet: Wallet,
  'credit-card': CreditCard,
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
  'credit-card',
  'wallet',
  'receipt',
  'coffee',
  'plane',
  'gift',
  'shield',
  'wrench',
  'fuel',
  'bus',
  'gamepad-2',
  'shirt',
  'baby',
  'paw-print',
  'book-open',
  'smartphone',
  'wifi',
  'landmark',
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
const CATEGORIES_PAGE_SIZE = 12

const DEFAULT_CATEGORY_FORM = {
  name: '',
  type: 'expense' as TransactionType,
  color: '#7C5CFF',
  icon: 'tag',
}

const COLOR_KEYS = {
  '#22c55e': 'green',
  '#f59e0b': 'amber',
  '#3b82f6': 'blue',
  '#7c5cff': 'purple',
  '#ef4444': 'red',
  '#06b6d4': 'cyan',
  '#ec4899': 'pink',
  '#71717a': 'gray',
  '#f97316': 'orange',
  '#8b5cf6': 'violet',
  '#a855f7': 'seededPurple',
  '#10b981': 'emerald',
  '#14b8a6': 'teal',
  '#059669': 'darkEmerald',
  '#6366f1': 'indigo',
} as const

type ColorName = (typeof COLOR_KEYS)[keyof typeof COLOR_KEYS] | 'custom'

function colorMessageKey(color: string): `colors.${ColorName}` {
  const key = COLOR_KEYS[color.trim().toLowerCase() as keyof typeof COLOR_KEYS]
  return `colors.${key ?? 'custom'}`
}

function isSameColor(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
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
  'credit-card': 'Card',
  wallet: 'Wallet',
  receipt: 'Receipt',
  coffee: 'Coffee',
  plane: 'Travel',
  gift: 'Gifts',
  shield: 'Insurance',
  wrench: 'Repairs',
  fuel: 'Fuel',
  bus: 'Transit',
  'gamepad-2': 'Games',
  shirt: 'Clothing',
  baby: 'Children',
  'paw-print': 'Pets',
  'book-open': 'Books',
  smartphone: 'Phone',
  wifi: 'Internet',
  landmark: 'Bank',
}

function CategoryIcon({ name, size = 14 }: { name: string | null; size?: number }) {
  const Icon = name ? ICON_MAP[name] : null
  if (Icon) return <Icon size={size} />
  return <Tag size={size} />
}

export function CategoryManagement() {
  const { t } = useTranslation(['categories', 'common'])
  const { t: tCommon } = useTranslation('common')
  const { categories, isLoading, fetchError, fetch, add, update, remove } = useCategoryStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveAttempted, setSaveAttempted] = useState(false)
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [iconSearch, setIconSearch] = useState('')
  const [visibleCategoryCounts, setVisibleCategoryCounts] = useState<
    Record<TransactionType, number>
  >(() => ({
    expense: CATEGORIES_PAGE_SIZE,
    income: CATEGORIES_PAGE_SIZE,
    transfer: CATEGORIES_PAGE_SIZE,
  }))

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
        closeForm()
      } else if (selectedId) {
        await update(selectedId, { name, type: formType, color: formColor, icon: formIcon })
        toast.success(t('toast.updated'))
        closeForm()
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
  const filteredIcons = useMemo(() => {
    const query = iconSearch.trim().toLowerCase()
    if (!query) return DEFAULT_ICONS

    return DEFAULT_ICONS.filter((iconName) => {
      const label = ICON_LABELS[iconName] ?? iconName
      return iconName.includes(query) || label.toLowerCase().includes(query)
    })
  }, [iconSearch])

  const closeForm = () => {
    setSelectedId(null)
    setIsAdding(false)
    setSaveAttempted(false)
    setIsIconPickerOpen(false)
    setIconSearch('')
  }

  return (
    <div className="animate-fade-in-up page-content space-y-3">
      <PageToolbar
        actions={
          <Button size="sm" className="min-h-11" onClick={startAdd}>
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
      ) : categories.length === 0 ? (
        <NativePanel className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
            <LayoutGrid size={28} className="text-accent" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={startAdd}>
            <Plus size={16} />
            {t('addCategory')}
          </Button>
        </NativePanel>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
          {TYPE_OPTIONS.map((type) => {
            const typedCategories = categories.filter((cat) => cat.type === type)
            const visibleCount = visibleCategoryCounts[type] ?? CATEGORIES_PAGE_SIZE
            const visibleCategories = typedCategories.slice(0, visibleCount)
            return (
              <NativePanel key={type} className="p-3" aria-label={t(`types.${type}`)}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="font-heading text-sm font-semibold break-words">
                    {t(`types.${type}`)}
                  </h2>
                  <span className="border-border text-foreground rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {typedCategories.length}
                  </span>
                </div>
                <div className="space-y-2" role="list" aria-label={t(`types.${type}`)}>
                  {visibleCategories.map((cat) => {
                    const color = cat.color || '#7C5CFF'
                    return (
                      <div
                        key={cat.id}
                        role="listitem"
                        className="group border-border bg-surface hover:bg-muted/45 rounded-lg border p-2 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="grid size-11 shrink-0 place-items-center rounded-xl"
                            style={{
                              backgroundColor: `${color}20`,
                              color,
                            }}
                            aria-hidden="true"
                          >
                            <CategoryIcon name={cat.icon} size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => startEdit(cat.id)}
                              className="focus-visible:ring-ring/50 w-full min-w-0 rounded-md text-left text-sm font-semibold break-words focus-visible:ring-2 focus-visible:outline-none"
                            >
                              {cat.name}
                            </button>
                            <div className="mt-1 flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-foreground size-11"
                                aria-label={t('actions.edit', { name: cat.name })}
                                onClick={() => startEdit(cat.id)}
                              >
                                <Pencil size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive/80 hover:text-destructive size-11"
                                aria-label={t('actions.delete', { name: cat.name })}
                                onClick={() => setDeleteId(cat.id)}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {typedCategories.length === 0 && (
                    <p className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs">
                      {t('empty.group')}
                    </p>
                  )}
                </div>
                <ShowMorePagination
                  shown={visibleCategories.length}
                  total={typedCategories.length}
                  summaryLabel={tCommon('pagination.summary', {
                    shown: visibleCategories.length,
                    total: typedCategories.length,
                  })}
                  showMoreLabel={tCommon('pagination.showMore', {
                    count: Math.min(
                      CATEGORIES_PAGE_SIZE,
                      typedCategories.length - visibleCategories.length
                    ),
                  })}
                  onShowMore={() =>
                    setVisibleCategoryCounts((current) => ({
                      ...current,
                      [type]: (current[type] ?? CATEGORIES_PAGE_SIZE) + CATEGORIES_PAGE_SIZE,
                    }))
                  }
                  className="mt-4"
                />
              </NativePanel>
            )
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="border-border bg-surface max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl"
                style={{
                  backgroundColor: `${formColor}20`,
                  color: formColor,
                }}
              >
                <CategoryIcon name={formIcon} size={18} />
              </div>
              <div>
                <DialogTitle className="font-heading text-xl break-words">
                  {isAdding ? t('newCategory') : selected?.name}
                </DialogTitle>
                <DialogDescription>{t('modal.description')}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5">
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

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  id="category-color-label"
                  className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
                >
                  {t('form.color')}
                </label>
                <span
                  id="category-selected-color"
                  className="inline-flex min-w-0 items-center gap-2 text-sm font-medium"
                >
                  <span
                    className="border-border size-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: formColor }}
                    aria-hidden="true"
                  />
                  <span className="break-words">{t(colorMessageKey(formColor))}</span>
                </span>
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-labelledby="category-color-label"
                aria-describedby="category-selected-color"
              >
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={t('actions.selectColor', {
                      color: t(colorMessageKey(color)),
                    })}
                    aria-pressed={isSameColor(formColor, color)}
                    onClick={() => setFormColor(color)}
                    className={`focus-visible:ring-ring focus-visible:ring-offset-background size-11 rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
                      isSameColor(formColor, color)
                        ? 'ring-ring ring-offset-background ring-2 ring-offset-2'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label
                id="category-icon-label"
                className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
              >
                {t('form.icon')}
              </label>
              <button
                type="button"
                aria-labelledby="category-icon-label category-icon-current"
                onClick={() => setIsIconPickerOpen(true)}
                className="focus-visible:ring-ring border-border bg-surface hover:bg-muted/45 flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${formColor}20`, color: formColor }}
                  >
                    <CategoryIcon name={formIcon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span id="category-icon-current" className="block text-sm font-semibold">
                      {ICON_LABELS[formIcon] ?? formIcon}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">{formIcon}</span>
                  </span>
                </span>
                <span className="text-accent text-xs font-bold">{t('form.chooseIcon')}</span>
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !formName.trim()}>
              {isSaving
                ? t('common:actions.saving')
                : isAdding
                  ? t('createCategory')
                  : t('saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isIconPickerOpen} onOpenChange={setIsIconPickerOpen}>
        <DialogContent className="border-border bg-surface max-h-[82vh] overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">{t('iconPicker.title')}</DialogTitle>
            <DialogDescription>{t('iconPicker.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search
                size={16}
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <Input
                value={iconSearch}
                onChange={(event) => setIconSearch(event.target.value)}
                placeholder={t('iconPicker.searchPlaceholder')}
                className="pl-9"
              />
            </div>

            <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {filteredIcons.map((iconName) => {
                const isSelected = formIcon === iconName
                return (
                  <button
                    key={iconName}
                    type="button"
                    aria-label={t('actions.selectIcon', {
                      icon: ICON_LABELS[iconName] ?? iconName,
                    })}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setFormIcon(iconName)
                      setIsIconPickerOpen(false)
                      setIconSearch('')
                    }}
                    className={`focus-visible:ring-ring flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                      isSelected
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:text-foreground border-border bg-surface hover:bg-muted/45'
                    }`}
                  >
                    <span className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <CategoryIcon name={iconName} size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {ICON_LABELS[iconName] ?? iconName}
                      </span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {iconName}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            {filteredIcons.length === 0 && (
              <div className="border-border rounded-lg border border-dashed p-6 text-center">
                <p className="text-muted-foreground text-sm">{t('iconPicker.noResults')}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, column) => (
        <NativePanel key={column} className="space-y-2 p-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 3 }).map((_, row) => (
            <div key={row} className="flex items-center gap-2">
              <Skeleton className="size-11 rounded-xl" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </NativePanel>
      ))}
    </div>
  )
}
