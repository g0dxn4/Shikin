import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Folder,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { readNote, listNotes, initNotebook } from '@/lib/notebook'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
}

const QUICK_LINKS = [
  { key: 'latestReview', dir: 'weekly-reviews' },
  { key: 'holdings', dir: 'holdings' },
  { key: 'signals', dir: 'signals' },
  { key: 'education', dir: 'education' },
] as const

export function Notebook() {
  const { t } = useTranslation('notebook')


  const [tree, setTree] = useState<TreeNode[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['weekly-reviews', 'holdings', 'signals', 'education']))

  const loadTree = useCallback(async () => {
    setIsLoading(true)
    try {
      await initNotebook()
      const rootEntries = await listNotes()

      const nodes: TreeNode[] = []
      for (const entry of rootEntries) {
        if (entry.endsWith('/')) {
          const dirName = entry.slice(0, -1)
          const children = await loadDirChildren(dirName)
          nodes.push({
            name: dirName,
            path: dirName,
            isDirectory: true,
            children,
          })
        } else {
          nodes.push({ name: entry, path: entry, isDirectory: false })
        }
      }
      setTree(nodes)
    } catch (err) {
      console.warn('[Notebook] Failed to load tree:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  async function loadDirChildren(dir: string): Promise<TreeNode[]> {
    try {
      const entries = await listNotes(dir)
      return entries.map((entry) => {
        const isDir = entry.endsWith('/')
        return {
          name: isDir ? entry.slice(0, -1).split('/').pop()! : entry.split('/').pop()!,
          path: entry.endsWith('/') ? entry.slice(0, -1) : entry,
          isDirectory: isDir,
        }
      })
    } catch {
      return []
    }
  }

  const handleSelectNote = async (path: string) => {
    setSelectedPath(path)
    try {
      const text = await readNote(path)
      setContent(text)
    } catch {
      setContent(`*Could not load ${path}*`)
    }
  }

  const handleQuickLink = async (dir: string) => {
    setExpandedDirs((s) => new Set([...s, dir]))
    try {
      const entries = await listNotes(dir)
      const mdFiles = entries.filter((e) => e.endsWith('.md'))
      if (mdFiles.length > 0) {
        // Select the latest file (sorted, last item)
        await handleSelectNote(mdFiles[mdFiles.length - 1])
      }
    } catch {
      // No files yet
    }
  }

  const toggleDir = (dir: string) => {
    setExpandedDirs((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in-up page-content">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="glass-card space-y-2 p-3 lg:col-span-1">
            <Skeleton className="h-3 w-16" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <div className="glass-card space-y-3 p-6 lg:col-span-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up page-content">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* Quick Links */}
      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.map(({ key, dir }) => (
          <button
            key={key}
            onClick={() => handleQuickLink(dir)}
            className="bg-accent/10 text-accent hover:bg-accent/20 rounded-full px-3 py-1 font-mono text-[10px] tracking-wider transition-colors"
          >
            {t(`quickLinks.${key}`)}
          </button>
        ))}
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* File Tree */}
        <div className="glass-card overflow-y-auto p-3 lg:col-span-1" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <p className="text-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-wider">
            {t('fileTree')}
          </p>
          {tree.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('empty')}</p>
          ) : (
            <div className="space-y-0.5">
              {tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  selectedPath={selectedPath}
                  expandedDirs={expandedDirs}
                  onSelect={handleSelectNote}
                  onToggle={toggleDir}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content Viewer */}
        <div
          className="glass-card overflow-y-auto p-6 lg:col-span-3"
          style={{ maxHeight: 'calc(100vh - 200px)' }}
        >
          {selectedPath ? (
            <div className="prose-invert prose prose-sm max-w-none">
              <p className="text-muted-foreground mb-4 font-mono text-[10px] tracking-wider">
                {selectedPath}
              </p>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen size={32} className="text-muted-foreground mb-4" />
              <h2 className="font-heading mb-2 text-lg font-semibold">{t('selectNote')}</h2>
              <p className="text-muted-foreground text-sm">{t('selectNoteDescription')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TreeItem({
  node,
  selectedPath,
  expandedDirs,
  onSelect,
  onToggle,
}: {
  node: TreeNode
  selectedPath: string | null
  expandedDirs: Set<string>
  onSelect: (path: string) => void
  onToggle: (dir: string) => void
}) {
  const isExpanded = expandedDirs.has(node.path)
  const isSelected = selectedPath === node.path

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-white/[0.03]"
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div className="ml-3 space-y-0.5">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                expandedDirs={expandedDirs}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors ${
        isSelected
          ? 'bg-accent/10 text-accent'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
      }`}
    >
      <FileText size={12} />
      <span className="truncate">{node.name.replace('.md', '')}</span>
    </button>
  )
}
