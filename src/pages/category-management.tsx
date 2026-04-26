import { useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  ShoppingCart,
  Utensils,
  Car,
  Film,
  Zap,
  ShoppingBag,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Category {
  id: string
  name: string
  icon: React.ReactNode
  color: string
  transactions: number
  monthlyAvg: string
  budget: string
  overBudget: boolean
  subcategories: string[]
}

const MOCK_CATEGORIES: Category[] = [
  {
    id: '1',
    name: 'Groceries',
    icon: <ShoppingCart size={14} />,
    color: '#22c55e',
    transactions: 24,
    monthlyAvg: '$485',
    budget: '$500',
    overBudget: false,
    subcategories: ['Supermarket', 'Organic', 'Bulk'],
  },
  {
    id: '2',
    name: 'Dining',
    icon: <Utensils size={14} />,
    color: '#f59e0b',
    transactions: 18,
    monthlyAvg: '$340',
    budget: '$300',
    overBudget: true,
    subcategories: ['Restaurants', 'Coffee', 'Delivery'],
  },
  {
    id: '3',
    name: 'Transport',
    icon: <Car size={14} />,
    color: '#3b82f6',
    transactions: 12,
    monthlyAvg: '$180',
    budget: '$250',
    overBudget: false,
    subcategories: ['Gas', 'Rideshare', 'Parking'],
  },
  {
    id: '4',
    name: 'Entertainment',
    icon: <Film size={14} />,
    color: '#7C5CFF',
    transactions: 8,
    monthlyAvg: '$120',
    budget: '$150',
    overBudget: false,
    subcategories: ['Streaming', 'Events', 'Games'],
  },
  {
    id: '5',
    name: 'Utilities',
    icon: <Zap size={14} />,
    color: '#06b6d4',
    transactions: 5,
    monthlyAvg: '$210',
    budget: '$250',
    overBudget: false,
    subcategories: ['Electric', 'Water', 'Internet'],
  },
  {
    id: '6',
    name: 'Shopping',
    icon: <ShoppingBag size={14} />,
    color: '#ec4899',
    transactions: 15,
    monthlyAvg: '$290',
    budget: '$200',
    overBudget: true,
    subcategories: ['Clothing', 'Electronics', 'Home'],
  },
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
]

export function CategoryManagement() {
  const [selectedId, setSelectedId] = useState<string>(MOCK_CATEGORIES[0].id)
  const [selectedColor, setSelectedColor] = useState<string>(MOCK_CATEGORIES[0].color)

  const selected = MOCK_CATEGORIES.find((c) => c.id === selectedId) || MOCK_CATEGORIES[0]

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader
        title="Categories"
        actions={
          <Button>
            <Plus size={16} />
            Add Category
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* Category Table */}
        <div className="liquid-card overflow-hidden p-5">
          {/* Header */}
          <div className="text-muted-foreground mb-2 hidden grid-cols-[1fr_80px_100px_80px_60px] gap-4 px-2 font-mono text-[10px] tracking-wider uppercase md:grid">
            <span>Category</span>
            <span className="text-right">Txns</span>
            <span className="text-right">Monthly Avg</span>
            <span className="text-right">Budget</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Rows */}
          <div className="space-y-1">
            {MOCK_CATEGORIES.map((cat) => {
              const isSelected = cat.id === selectedId
              return (
                <div
                  key={cat.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(cat.id)
                    setSelectedColor(cat.color)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(cat.id)
                      setSelectedColor(cat.color)
                    }
                  }}
                  className={`focus-visible:ring-ring/50 grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-4 rounded-lg px-2 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none md:grid-cols-[1fr_80px_100px_80px_60px] ${
                    isSelected ? 'bg-accent/5' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                    >
                      {cat.icon}
                    </div>
                    <span className="text-sm font-medium">{cat.name}</span>
                  </div>

                  {/* Stats - desktop */}
                  <span className="text-muted-foreground hidden text-right font-mono text-sm md:block">
                    {cat.transactions}
                  </span>
                  <span className="text-muted-foreground hidden text-right font-mono text-sm md:block">
                    {cat.monthlyAvg}
                  </span>
                  <span
                    className={`hidden text-right font-mono text-sm font-semibold md:block ${
                      cat.overBudget ? 'text-destructive' : ''
                    }`}
                  >
                    {cat.budget}
                  </span>

                  {/* Actions */}
                  <div className="flex justify-end gap-0.5">
                    <button
                      type="button"
                      aria-label={`Edit ${cat.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedId(cat.id)
                        setSelectedColor(cat.color)
                      }}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-7 w-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${cat.name}`}
                      onClick={(event) => event.stopPropagation()}
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

        {/* Category Details Panel */}
        <div className="liquid-card space-y-6 p-5">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${selected.color}20`, color: selected.color }}
            >
              {selected.icon}
            </div>
            <h3 className="font-heading flex-1 text-lg font-semibold">{selected.name}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Pencil size={12} />
            </Button>
          </div>

          {/* Color picker */}
          <div className="space-y-2">
            <label
              id="category-color-label"
              className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
            >
              Color
            </label>
            <div className="flex gap-2" role="group" aria-labelledby="category-color-label">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Select color ${color}`}
                  aria-pressed={selectedColor === color}
                  onClick={() => setSelectedColor(color)}
                  className={`h-8 w-8 rounded-full transition-transform hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100 ${
                    selectedColor === color
                      ? 'ring-offset-background ring-2 ring-white ring-offset-2'
                      : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Monthly Budget */}
          <div className="space-y-2">
            <label
              htmlFor="category-monthly-budget"
              className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase"
            >
              Monthly Budget
            </label>
            <Input
              id="category-monthly-budget"
              type="number"
              defaultValue={selected.budget.replace('$', '')}
              placeholder="Enter budget amount"
            />
          </div>

          {/* Subcategories */}
          <div className="space-y-2">
            <label className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Subcategories
            </label>
            <div className="flex flex-wrap gap-2">
              {selected.subcategories.map((sub) => (
                <span key={sub} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs">
                  {sub}
                </span>
              ))}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded-full border border-dashed border-white/10 px-3 py-1 text-xs transition-colors hover:border-white/20"
              >
                <Plus size={10} className="mr-1 inline" />
                Add
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="space-y-2 border-t border-white/5 pt-4">
            <label className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Quick Stats
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                <p className="text-muted-foreground text-[10px]">Transactions</p>
                <p className="font-heading text-lg font-bold">{selected.transactions}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                <p className="text-muted-foreground text-[10px]">Monthly Avg</p>
                <p className="font-heading text-lg font-bold">{selected.monthlyAvg}</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button className="flex-1">Save Changes</Button>
            <Button variant="outline" className="text-destructive hover:text-destructive">
              Delete Category
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
