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
  const { categories, isLoading, fetchError, fetch, add, update, remove } = useCategoryStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveAttempted, setSaveAttempted] = useState(false)
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [iconSearch, setIconSearch] = useState('')

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
  const counts = TYPE_OPTIONS.map((type) => ({
    type,
    count: categories.filter((cat) => cat.type === type).length,
  }))
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
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">{t('subtitle')}</p>
        </div>
        <Button onClick={startAdd}>
          <Plus size={16} />
          {t('addCategory')}
        </Button>
      </div>

      <div className="liquid-hero overflow-hidden p-6 sm:p-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-muted-foreground text-sm font-bold tracking-[0.14em] uppercase">
              {t('hero.kicker')}
            </p>
            <p className="font-heading mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {categories.length}
            </p>
            <p className="text-muted-foreground mt-3 max-w-xl text-sm font-medium">
              {t('hero.description')}
            </p>
          </div>
          <div className="grid min-w-full grid-cols-3 gap-3 lg:min-w-[420px]">
            {counts.map(({ type, count }) => (
              <div
                key={type}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4"
              >
                <p className="text-muted-foreground text-xs font-bold">{t(`types.${type}`)}</p>
                <p className="font-mono text-2xl font-bold">{count}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

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
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {TYPE_OPTIONS.map((type) => {
            const typedCategories = categories.filter((cat) => cat.type === type)
            return (
              <section
                key={type}
                className="liquid-card min-h-[360px] p-5"
                aria-label={t(`types.${type}`)}
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-xl font-bold tracking-tight">
                      {t(`types.${type}`)}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {typedCategories.length}
                  </Badge>
                </div>
                <div className="space-y-2" role="list" aria-label={t(`types.${type}`)}>
                  {typedCategories.map((cat) => (
                    <div
                      key={cat.id}
                      role="listitem"
                      className="group rounded-[20px] border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={cat.name}
                          onClick={() => startEdit(cat.id)}
                          className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                            style={{
                              backgroundColor: `${cat.color || '#7C5CFF'}20`,
                              color: cat.color || '#7C5CFF',
                            }}
                          >
                            <CategoryIcon name={cat.icon} size={16} />
                          </div>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{cat.name}</span>
                          </span>
                        </button>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground h-8 w-8"
                            aria-label={t('actions.edit', { name: cat.name })}
                            onClick={() => startEdit(cat.id)}
                          >
                            <Pencil size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive/80 hover:text-destructive h-8 w-8"
                            aria-label={t('actions.delete', { name: cat.name })}
                            onClick={() => setDeleteId(cat.id)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {typedCategories.length === 0 && (
                    <div className="rounded-[20px] border border-dashed border-white/[0.08] p-4 text-center">
                      <p className="text-muted-foreground text-sm">{t('empty.group')}</p>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="liquid-card max-h-[90vh] overflow-y-auto border-white/[0.08] sm:max-w-2xl">
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
                <DialogTitle className="font-heading text-xl">
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
                className="focus-visible:ring-ring flex w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:outline-none"
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
                <span className="text-primary text-xs font-bold">{t('form.chooseIcon')}</span>
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
        <DialogContent className="liquid-card max-h-[82vh] overflow-hidden border-white/[0.08] sm:max-w-xl">
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
                        : 'text-muted-foreground hover:text-foreground border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
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
              <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center">
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
