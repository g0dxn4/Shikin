import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Search, Pencil, Trash2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { query, execute } from '@/lib/database'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

// ── Types ───────────────────────────────────────────────────────────────────

interface Memory {
  id: string
  category: string
  content: string
  importance: number
  created_at: string
  updated_at: string
  last_accessed_at: string | null
}

type MemoryCategory = 'all' | 'preference' | 'fact' | 'goal' | 'behavior' | 'context'
type SortOption = 'importance' | 'newest' | 'oldest' | 'accessed'

// ── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES: MemoryCategory[] = ['all', 'preference', 'fact', 'goal', 'behavior', 'context']

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  preference: {
    bg: 'rgba(191, 90, 242, 0.15)',
    text: '#bf5af2',
    border: 'rgba(191, 90, 242, 0.3)',
  },
  fact: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
  goal: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
  behavior: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
  context: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af', border: 'rgba(156, 163, 175, 0.3)' },
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  preference: 'Preferences',
  fact: 'Facts',
  goal: 'Goals',
  behavior: 'Patterns',
  context: 'Context',
}

function getImportanceColor(importance: number): { bg: string; text: string } {
  if (importance >= 8) return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' }
  if (importance >= 5) return { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' }
  return { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af' }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── MemoryCard ──────────────────────────────────────────────────────────────

function MemoryCard({
  memory,
  onDelete,
  onUpdate,
}: {
  memory: Memory
  onDelete: (id: string) => void
  onUpdate: (id: string, content: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(memory.content)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const catColors = CATEGORY_COLORS[memory.category] || CATEGORY_COLORS.context
  const impColors = getImportanceColor(memory.importance)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  const handleSave = async () => {
    const trimmed = editContent.trim()
    if (!trimmed || trimmed === memory.content) {
      setEditing(false)
      setEditContent(memory.content)
      return
    }
    setSaving(true)
    try {
      await onUpdate(memory.id, trimmed)
      setEditing(false)
    } catch {
      toast.error('Failed to update memory')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setEditContent(memory.content)
  }

  return (
    <div className="glass-card group relative overflow-hidden p-5 transition-transform duration-200 hover:translate-y-[-2px]">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="text-[10px]"
            style={{
              backgroundColor: catColors.bg,
              color: catColors.text,
              borderColor: catColors.border,
            }}
          >
            {memory.category}
          </Badge>
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold"
            style={{
              backgroundColor: impColors.bg,
              color: impColors.text,
            }}
          >
            {memory.importance}
          </span>
        </div>
        <div className="flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-500 hover:text-green-400"
                onClick={handleSave}
                disabled={saving}
                aria-label="Save"
              >
                <Check size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCancel}
                disabled={saving}
                aria-label="Cancel"
              >
                <X size={12} />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setEditing(true)}
                aria-label={t('actions.edit')}
              >
                <Pencil size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive h-7 w-7"
                onClick={() => onDelete(memory.id)}
                aria-label={t('actions.delete')}
              >
                <Trash2 size={12} />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="min-h-[80px] w-full resize-y rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
        />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{memory.content}</p>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-muted-foreground font-mono text-[10px] tracking-wider">
          {formatDate(memory.created_at)}
        </p>
        {memory.updated_at !== memory.created_at && (
          <p className="text-muted-foreground font-mono text-[10px] tracking-wider">
            updated {formatDate(memory.updated_at)}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Memories Page ───────────────────────────────────────────────────────────

export function Memories() {
  const { t } = useTranslation()
  const [memories, setMemories] = useState<Memory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState<MemoryCategory>('all')
  const [sortBy, setSortBy] = useState<SortOption>('importance')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchMemories = useCallback(async () => {
    setIsLoading(true)
    try {
      let rows: Memory[]

      if (searchQuery.trim()) {
        // FTS5 search
        const ftsQuery = searchQuery.trim().replace(/['"]/g, '')
        if (category === 'all') {
          rows = await query<Memory>(
            `SELECT m.id, m.category, m.content, m.importance, m.created_at, m.updated_at, m.last_accessed_at
             FROM ai_memories m
             WHERE m.rowid IN (SELECT rowid FROM ai_memories_fts WHERE ai_memories_fts MATCH ?)
             ORDER BY m.importance DESC`,
            [`${ftsQuery}*`]
          )
        } else {
          rows = await query<Memory>(
            `SELECT m.id, m.category, m.content, m.importance, m.created_at, m.updated_at, m.last_accessed_at
             FROM ai_memories m
             WHERE m.rowid IN (SELECT rowid FROM ai_memories_fts WHERE ai_memories_fts MATCH ?)
             AND m.category = ?
             ORDER BY m.importance DESC`,
            [`${ftsQuery}*`, category]
          )
        }
      } else {
        if (category === 'all') {
          rows = await query<Memory>(
            `SELECT id, category, content, importance, created_at, updated_at, last_accessed_at
             FROM ai_memories
             ORDER BY importance DESC, updated_at DESC`
          )
        } else {
          rows = await query<Memory>(
            `SELECT id, category, content, importance, created_at, updated_at, last_accessed_at
             FROM ai_memories
             WHERE category = ?
             ORDER BY importance DESC, updated_at DESC`,
            [category]
          )
        }
      }

      setMemories(rows)
    } catch (err) {
      console.error('[Memories] fetch error:', err)
      toast.error('Failed to load memories')
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery, category])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  // Client-side sorting
  const sortedMemories = [...memories].sort((a, b) => {
    switch (sortBy) {
      case 'importance':
        return b.importance - a.importance || b.updated_at.localeCompare(a.updated_at)
      case 'newest':
        return b.created_at.localeCompare(a.created_at)
      case 'oldest':
        return a.created_at.localeCompare(b.created_at)
      case 'accessed':
        return (b.last_accessed_at || '').localeCompare(a.last_accessed_at || '')
      default:
        return 0
    }
  })

  const handleUpdate = async (id: string, content: string) => {
    await execute(
      `UPDATE ai_memories SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      [content, id]
    )
    setMemories((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, updated_at: new Date().toISOString() } : m))
    )
    toast.success('Memory updated')
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await execute('DELETE FROM ai_memories WHERE id = ?', [deleteId])
      setMemories((prev) => prev.filter((m) => m.id !== deleteId))
      toast.success('Memory deleted')
      setDeleteId(null)
    } catch {
      toast.error('Failed to delete memory')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('nav.memories')}</h1>
        <p className="text-muted-foreground text-sm">
          {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
        </p>
      </div>

      {/* Toolbar: search + sort */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            size={14}
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setSortBy(e.target.value as SortOption)
          }
          className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm outline-none"
        >
          <option value="importance">Importance</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="accessed">Recently Accessed</option>
        </select>
      </div>

      {/* Category filter tabs */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            style={
              category === cat
                ? {
                    backgroundColor:
                      cat === 'all'
                        ? 'rgba(255,255,255,0.1)'
                        : CATEGORY_COLORS[cat]?.bg || 'rgba(255,255,255,0.1)',
                    color: cat === 'all' ? '#f0f0f0' : CATEGORY_COLORS[cat]?.text || '#f0f0f0',
                    border: `1px solid ${cat === 'all' ? 'rgba(255,255,255,0.15)' : CATEGORY_COLORS[cat]?.border || 'rgba(255,255,255,0.15)'}`,
                  }
                : {
                    backgroundColor: 'transparent',
                    color: '#9ca3af',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }
            }
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card space-y-3 p-5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-5 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : sortedMemories.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Brain size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">
            {searchQuery ? 'No memories found' : "Ivy doesn't have any memories yet"}
          </h2>
          <p className="text-muted-foreground mb-4 text-sm">
            {searchQuery
              ? 'Try a different search term or category'
              : 'Memories are created automatically as you chat with Ivy'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedMemories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onDelete={setDeleteId}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}

      <Suspense>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title="Delete Memory"
          description="Are you sure you want to delete this memory? Ivy will no longer remember this information."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}
