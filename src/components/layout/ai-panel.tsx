import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import {
  X,
  Sparkles,
  Send,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  ChevronDown,
  Minimize2,
  Wrench,
  ChevronRight,
  Clock3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAIStore } from '@/stores/ai-store'
import { useConversationStore } from '@/stores/conversation-store'
import { createTransport } from '@/ai/transport'
import { createLanguageModel, type AIProvider } from '@/ai/agent'
import { shouldCompact, compactMessages, COMPACTION_THRESHOLD } from '@/ai/compaction'
import { AI_PANEL_WIDTH } from '@/lib/constants'

interface ToolTiming {
  startedAt: number
  durationMs?: number
}

export function AIPanel() {
  const { t } = useTranslation('ai')
  const { aiPanelOpen, setAIPanelOpen } = useUIStore()
  const {
    provider,
    apiKey,
    model,
    isConfigured,
    authMode,
    oauthAccessToken,
    codexAccountId,
    getEffectiveApiKey,
  } = useAIStore()
  const {
    currentConversationId,
    conversations,
    isLoading: isConversationLoading,
    hasOlderMessages,
    loadConversations,
    startNewConversation,
    switchConversation,
    prependOlderMessages,
    persistMessage,
    autoTitle,
    removeConversation,
  } = useConversationStore()

  // Trigger token refresh if needed (updates oauthAccessToken in store, which recreates transport)
  useEffect(() => {
    if (authMode === 'oauth' && isConfigured) {
      getEffectiveApiKey()
    }
  }, [authMode, isConfigured, getEffectiveApiKey])

  const [inputValue, setInputValue] = useState('')
  const [showConversations, setShowConversations] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [toolTimings, setToolTimings] = useState<Record<string, ToolTiming>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasAutoTitled = useRef(false)
  const conversationsLoaded = useRef(false)

  const transport = useMemo(() => {
    if (!isConfigured) return null
    const effectiveKey = authMode === 'oauth' ? oauthAccessToken || '' : apiKey
    return createTransport(provider as AIProvider, effectiveKey, model || undefined, {
      authMode,
      codexAccountId: codexAccountId ?? undefined,
    })
  }, [provider, apiKey, model, isConfigured, authMode, oauthAccessToken, codexAccountId])

  const chatId = useMemo(() => `val-${provider}-${model || 'default'}`, [provider, model])

  const { messages, setMessages, sendMessage, status, error } = useChat({
    id: chatId,
    transport: transport ?? undefined,
    onFinish: async ({ message }) => {
      await persistMessage(message)

      if (!hasAutoTitled.current && messages.length <= 2) {
        const firstUserMsg = messages.find((m) => m.role === 'user')
        if (firstUserMsg) {
          const text = firstUserMsg.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join(' ')
          if (text) {
            await autoTitle(text)
            hasAutoTitled.current = true
          }
        }
      }

      const allMessages = [...messages, message]
      if (shouldCompact(allMessages) && currentConversationId && isConfigured) {
        try {
          const languageModel = createLanguageModel(
            provider as AIProvider,
            apiKey,
            model || undefined
          )
          const compacted = await compactMessages(currentConversationId, allMessages, languageModel)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setMessages(compacted as any)
        } catch (err) {
          console.error('[Val] Compaction failed:', err)
        }
      }
    },
    onError: (err) => {
      console.error('[Val AI Error]', err)
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    if (aiPanelOpen && !conversationsLoaded.current) {
      conversationsLoaded.current = true
      loadConversations().then(async () => {
        const { conversations: convos } = useConversationStore.getState()
        if (convos.length > 0 && !currentConversationId) {
          const msgs = await switchConversation(convos[0].id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setMessages(msgs as any)
          hasAutoTitled.current = true
        }
      })
    }
  }, [aiPanelOpen, loadConversations, switchConversation, setMessages, currentConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setToolTimings((previous) => {
      const next = { ...previous }
      const now = Date.now()
      let changed = false

      for (const msg of messages) {
        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i]
          if (!part.type.startsWith('tool-')) continue

          const toolId = `${msg.id}-${i}`
          const timing = next[toolId]

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolPart = part as any
          const state = toolPart.state || toolPart.toolInvocation?.state || ''
          const isRunning =
            state === 'call' || state === 'partial-call' || state === 'input-streaming'

          if (isRunning && !timing) {
            next[toolId] = { startedAt: now }
            changed = true
          }

          if (!isRunning && timing && timing.durationMs === undefined) {
            next[toolId] = {
              ...timing,
              durationMs: Math.max(0, now - timing.startedAt),
            }
            changed = true
          }
        }
      }

      return changed ? next : previous
    })
  }, [messages])

  const handleNewChat = useCallback(async () => {
    if (!isConfigured) return
    await startNewConversation(model || undefined)
    setMessages([])
    hasAutoTitled.current = false
    setShowConversations(false)
  }, [isConfigured, startNewConversation, model, setMessages])

  const handleSwitchConversation = useCallback(
    async (id: string) => {
      const msgs = await switchConversation(id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages(msgs as any)
      hasAutoTitled.current = true
      setShowConversations(false)
    },
    [switchConversation, setMessages]
  )

  const handleDeleteConversation = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      await removeConversation(id)
      if (id === currentConversationId) {
        setMessages([])
        hasAutoTitled.current = false
      }
    },
    [removeConversation, currentConversationId, setMessages]
  )

  const handleCompact = useCallback(async () => {
    if (!currentConversationId || !isConfigured || messages.length < 4) return
    setIsCompacting(true)
    try {
      const languageModel = createLanguageModel(provider as AIProvider, apiKey, model || undefined)
      const compacted = await compactMessages(currentConversationId, messages, languageModel, true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages(compacted as any)
    } catch (err) {
      console.error('[Val] Compaction failed:', err)
    } finally {
      setIsCompacting(false)
    }
  }, [currentConversationId, isConfigured, messages, provider, apiKey, model, setMessages])

  const handleLoadOlder = useCallback(async () => {
    if (!hasOlderMessages || isLoadingOlder) return
    setIsLoadingOlder(true)
    try {
      const older = await prependOlderMessages()
      if (older.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setMessages((prev) => [...(older as any), ...prev])
      }
    } finally {
      setIsLoadingOlder(false)
    }
  }, [hasOlderMessages, isLoadingOlder, prependOlderMessages, setMessages])

  const toggleToolExpanded = useCallback((id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (!aiPanelOpen) return null

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !transport) return

    let conversationId = currentConversationId
    if (!currentConversationId) {
      conversationId = await startNewConversation(model || undefined)
    }

    const text = inputValue.trim()
    setInputValue('')

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }],
    }
    await persistMessage(userMessage, conversationId || undefined)
    sendMessage({ text })
  }

  const handleSuggestion = async (suggestion: string) => {
    if (!transport) return
    let conversationId = currentConversationId
    if (!currentConversationId) {
      conversationId = await startNewConversation(model || undefined)
    }
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: suggestion }],
    }
    await persistMessage(userMessage, conversationId || undefined)
    sendMessage({ text: suggestion })
  }

  const currentConvo = conversations.find((c) => c.id === currentConversationId)

  return (
    <aside
      className="glass-panel animate-slide-in-right flex h-screen flex-col"
      style={{ width: AI_PANEL_WIDTH }}
    >
      {/* Header */}
      <div className="border-border flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <div className="bg-accent-muted flex h-7 w-7 items-center justify-center rounded-lg">
            <Sparkles size={14} className="text-primary" />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowConversations(!showConversations)}
              className="flex items-center gap-1 hover:opacity-80"
            >
              <div>
                <h2 className="font-heading text-left text-sm font-semibold">
                  {currentConvo?.title || t('panel.title')}
                </h2>
                <p className="text-muted-foreground text-left text-[10px]">{t('panel.subtitle')}</p>
              </div>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>

            {showConversations && (
              <div className="glass-panel border-border absolute top-full left-0 z-50 mt-2 w-64 border shadow-lg">
                <div className="border-border border-b p-2">
                  <button
                    onClick={handleNewChat}
                    className="hover:bg-surface flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
                  >
                    <Plus size={14} />
                    New Chat
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {conversations.length === 0 ? (
                    <p className="text-muted-foreground px-3 py-2 text-xs">No conversations yet</p>
                  ) : (
                    conversations.map((convo) => (
                      <button
                        key={convo.id}
                        onClick={() => handleSwitchConversation(convo.id)}
                        className={cn(
                          'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                          convo.id === currentConversationId
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-surface text-foreground'
                        )}
                      >
                        <MessageSquare size={14} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{convo.title}</span>
                        <button
                          onClick={(e) => handleDeleteConversation(e, convo.id)}
                          className="text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 hover:text-red-400"
                          aria-label={`Delete conversation ${convo.title}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setAIPanelOpen(false)}
          className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 hover:bg-white/5"
          aria-label="Close AI panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4" onClick={() => setShowConversations(false)}>
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Sparkles size={24} className="text-muted-foreground" />
            <p className="text-muted-foreground text-sm">{t('errors.noProvider')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="bg-accent-muted flex h-12 w-12 items-center justify-center rounded-full">
              <Sparkles size={24} className="text-primary" />
            </div>
            <h3 className="font-heading text-lg font-semibold">{t('panel.empty.title')}</h3>
            <p className="text-muted-foreground text-sm">{t('panel.empty.description')}</p>
            <div className="mt-2 flex flex-col gap-2">
              {(t('panel.empty.suggestions', { returnObjects: true }) as string[]).map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestion(suggestion)}
                    className="glass-card text-muted-foreground hover:border-border-hover hover:text-foreground px-3 py-2 text-left text-xs transition-colors"
                  >
                    {suggestion}
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(hasOlderMessages || isConversationLoading) && (
              <div className="flex justify-center">
                <button
                  onClick={handleLoadOlder}
                  disabled={!hasOlderMessages || isLoadingOlder || isConversationLoading}
                  className="text-muted-foreground hover:text-foreground rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] tracking-wide uppercase disabled:opacity-40"
                >
                  {isLoadingOlder || isConversationLoading ? 'Loading...' : 'Load older messages'}
                </button>
              </div>
            )}
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                expandedTools={expandedTools}
                onToggleTool={toggleToolExpanded}
                toolTimings={toolTimings}
              />
            ))}
            {isLoading && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 size={14} className="animate-spin" />
                {t('panel.thinking')}
              </div>
            )}
            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                Error: {error.message || String(error)}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-border border-t p-3">
        {messages.length >= 4 && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground text-[10px]">
              {t('panel.messageCount', { count: messages.length })}
              {messages.length >= COMPACTION_THRESHOLD && ` — ${t('panel.autoCompactSoon')}`}
            </span>
            <button
              onClick={handleCompact}
              disabled={isCompacting || isLoading || messages.length < 4}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-2 py-1 text-[10px] hover:bg-white/5 disabled:opacity-30"
              title={t('panel.compactTooltip')}
            >
              {isCompacting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Minimize2 size={10} />
              )}
              {t('panel.compact')}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={t('panel.placeholder')}
            className="glass-input flex-1 px-3 py-2 text-sm"
            disabled={!isConfigured || isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!isConfigured || isLoading || !inputValue.trim()}
            className={cn(
              'flex items-center justify-center px-3 py-2 text-sm transition-colors',
              isConfigured && inputValue.trim()
                ? 'bg-primary text-primary-foreground hover:bg-accent-hover'
                : 'bg-muted text-muted-foreground opacity-50'
            )}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function ChatBubble({
  message: msg,
  expandedTools,
  onToggleTool,
  toolTimings,
}: {
  message: UIMessage
  expandedTools: Set<string>
  onToggleTool: (id: string) => void
  toolTimings: Record<string, ToolTiming>
}) {
  const isUser = msg.role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-surface border-border rounded-bl-sm border'
        )}
      >
        {msg.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <div key={i} className="leading-relaxed break-words whitespace-pre-wrap">
                {renderMarkdownLite(part.text)}
              </div>
            )
          }
          if (part.type.startsWith('tool-')) {
            const toolId = `${msg.id}-${i}`
            const isExpanded = expandedTools.has(toolId)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolPart = part as any
            const toolName = toolPart.toolName || toolPart.toolInvocation?.toolName || 'tool'
            const state = toolPart.state || toolPart.toolInvocation?.state || ''
            const result = toolPart.result ?? toolPart.toolInvocation?.result
            const isRunning =
              state === 'call' || state === 'partial-call' || state === 'input-streaming'
            const timing = toolTimings[toolId]
            const hasError =
              state === 'error' ||
              (typeof result === 'object' && result !== null && 'error' in result)

            return (
              <div key={i} className="my-1 rounded-lg bg-white/5 px-2.5 py-1.5">
                <button
                  onClick={() => onToggleTool(toolId)}
                  className="text-muted-foreground flex w-full items-center gap-1.5 text-left font-mono text-[11px]"
                >
                  {isRunning ? (
                    <Loader2 size={10} className="shrink-0 animate-spin" />
                  ) : (
                    <Wrench size={10} className="shrink-0" />
                  )}
                  <span className="truncate">{toolName}</span>
                  {hasError ? (
                    <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] text-red-300 uppercase">
                      error
                    </span>
                  ) : isRunning ? (
                    <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-300 uppercase">
                      running
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] text-emerald-300 uppercase">
                      done
                    </span>
                  )}
                  {!isRunning && timing?.durationMs !== undefined && (
                    <span className="text-[9px] text-white/60">
                      <Clock3 size={9} className="mr-0.5 inline-block" />
                      {`${timing.durationMs}ms`}
                    </span>
                  )}
                  {!isRunning && result !== undefined && (
                    <ChevronRight
                      size={10}
                      className={cn(
                        'ml-auto shrink-0 transition-transform',
                        isExpanded && 'rotate-90'
                      )}
                    />
                  )}
                </button>
                {isExpanded && result !== undefined && (
                  <pre className="text-muted-foreground mt-1.5 max-h-24 overflow-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                    {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

/** Minimal markdown: **bold**, *italic*, `code`, and newlines */
function renderMarkdownLite(text: string): React.ReactNode {
  // Split into segments for inline formatting
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(
        <strong key={match.index} className="font-semibold">
          {match[2]}
        </strong>
      )
    } else if (match[3]) {
      parts.push(
        <em key={match.index} className="italic">
          {match[3]}
        </em>
      )
    } else if (match[4]) {
      parts.push(
        <code key={match.index} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em]">
          {match[4]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}
