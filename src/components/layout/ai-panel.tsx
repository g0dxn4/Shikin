import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { X, Sparkles, Send, Loader2, Plus, MessageSquare, Trash2, ChevronDown, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAIStore } from '@/stores/ai-store'
import { useConversationStore } from '@/stores/conversation-store'
import { createTransport } from '@/ai/transport'
import { createLanguageModel, type AIProvider } from '@/ai/agent'
import { shouldCompact, compactMessages, COMPACTION_THRESHOLD } from '@/ai/compaction'
import { AI_PANEL_WIDTH } from '@/lib/constants'

export function AIPanel() {
  const { t } = useTranslation('ai')
  const { aiPanelOpen, setAIPanelOpen } = useUIStore()
  const { provider, apiKey, model, isConfigured } = useAIStore()
  const {
    currentConversationId,
    conversations,
    loadConversations,
    startNewConversation,
    switchConversation,
    persistMessage,
    autoTitle,
    removeConversation,
  } = useConversationStore()

  const [inputValue, setInputValue] = useState('')
  const [showConversations, setShowConversations] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasAutoTitled = useRef(false)
  const conversationsLoaded = useRef(false)

  const transport = useMemo(() => {
    if (!isConfigured) return null
    return createTransport(
      provider as AIProvider,
      apiKey,
      model || undefined
    )
  }, [provider, apiKey, model, isConfigured])

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: transport ?? undefined,
    onFinish: async ({ message }) => {
      // Persist the assistant message
      await persistMessage(message)

      // Auto-title on first exchange
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

      // Check for compaction
      const allMessages = [...messages, message]
      if (shouldCompact(allMessages) && currentConversationId && isConfigured) {
        try {
          const languageModel = createLanguageModel(
            provider as AIProvider,
            apiKey,
            model || undefined
          )
          const compacted = await compactMessages(
            currentConversationId,
            allMessages,
            languageModel
          )
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

  // Load conversations on mount
  useEffect(() => {
    if (aiPanelOpen && !conversationsLoaded.current) {
      conversationsLoaded.current = true
      loadConversations().then(async () => {
        // Resume the most recent conversation if one exists
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

  const handleNewChat = useCallback(async () => {
    if (!isConfigured) return
    await startNewConversation(model || undefined)
    setMessages([])
    hasAutoTitled.current = false
    setShowConversations(false)
  }, [isConfigured, startNewConversation, model, setMessages])

  const handleSwitchConversation = useCallback(async (id: string) => {
    const msgs = await switchConversation(id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMessages(msgs as any)
    hasAutoTitled.current = true
    setShowConversations(false)
  }, [switchConversation, setMessages])

  const handleDeleteConversation = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await removeConversation(id)
    if (id === currentConversationId) {
      setMessages([])
      hasAutoTitled.current = false
    }
  }, [removeConversation, currentConversationId, setMessages])

  const handleCompact = useCallback(async () => {
    if (!currentConversationId || !isConfigured || messages.length < 4) return
    setIsCompacting(true)
    try {
      const languageModel = createLanguageModel(
        provider as AIProvider,
        apiKey,
        model || undefined
      )
      const compacted = await compactMessages(
        currentConversationId,
        messages,
        languageModel,
        true // force — manual trigger
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages(compacted as any)
    } catch (err) {
      console.error('[Val] Compaction failed:', err)
    } finally {
      setIsCompacting(false)
    }
  }, [currentConversationId, isConfigured, messages, provider, apiKey, model, setMessages])

  if (!aiPanelOpen) return null

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !transport) return

    // Create conversation if none exists
    if (!currentConversationId) {
      await startNewConversation(model || undefined)
    }

    const text = inputValue.trim()
    setInputValue('')

    // Persist the user message
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }],
    }
    await persistMessage(userMessage)

    sendMessage({ text })
  }

  const handleSuggestion = async (suggestion: string) => {
    if (!transport) return
    if (!currentConversationId) {
      await startNewConversation(model || undefined)
    }
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: suggestion }],
    }
    await persistMessage(userMessage)
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
          <Sparkles size={18} className="text-primary" />
          <div className="relative">
            <button
              onClick={() => setShowConversations(!showConversations)}
              className="flex items-center gap-1 hover:opacity-80"
            >
              <div>
                <h2 className="font-heading text-left text-sm font-semibold">
                  {currentConvo?.title || t('panel.title')}
                </h2>
                <p className="text-muted-foreground text-left text-xs">{t('panel.subtitle')}</p>
              </div>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>

            {/* Conversation dropdown */}
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
                          className="text-muted-foreground hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
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
                    className="glass-card text-muted-foreground hover:border-border-hover hover:text-foreground px-3 py-2 text-left text-xs"
                  >
                    {suggestion}
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'max-w-[90%] rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground ml-auto'
                    : 'bg-surface text-foreground'
                )}
              >
                {msg.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return (
                      <p key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </p>
                    )
                  }
                  if (part.type.startsWith('tool-')) {
                    return (
                      <p key={i} className="text-muted-foreground font-mono text-xs">
                        Using tool...
                      </p>
                    )
                  }
                  return null
                })}
              </div>
            ))}
            {isLoading && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 size={14} className="animate-spin" />
                {t('panel.thinking')}
              </div>
            )}
            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                Error: {error.message}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-border border-t p-4">
        {messages.length >= 4 && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              {messages.length} messages{messages.length >= COMPACTION_THRESHOLD && ' — auto-compact soon'}
            </span>
            <button
              onClick={handleCompact}
              disabled={isCompacting || isLoading || messages.length < 4}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs hover:bg-white/5 rounded px-2 py-1 disabled:opacity-30"
              title="Summarize older messages to free up context"
            >
              {isCompacting ? <Loader2 size={12} className="animate-spin" /> : <Minimize2 size={12} />}
              Compact
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
              'flex items-center justify-center px-3 py-2 text-sm',
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
