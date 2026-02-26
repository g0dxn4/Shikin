import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useChat } from '@ai-sdk/react'
import { X, Sparkles, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAIStore } from '@/stores/ai-store'
import { createTransport } from '@/ai/transport'
import { AI_PANEL_WIDTH } from '@/lib/constants'

export function AIPanel() {
  const { t } = useTranslation('ai')
  const { aiPanelOpen, setAIPanelOpen } = useUIStore()
  const { provider, apiKey, model, isConfigured } = useAIStore()
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(() => {
    if (!isConfigured) return null
    return createTransport(
      provider as 'openai' | 'anthropic' | 'ollama',
      apiKey,
      model || undefined
    )
  }, [provider, apiKey, model, isConfigured])

  const { messages, sendMessage, status } = useChat({
    transport: transport ?? undefined,
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!aiPanelOpen) return null

  const handleSend = () => {
    if (!inputValue.trim() || isLoading || !transport) return
    sendMessage({ text: inputValue.trim() })
    setInputValue('')
  }

  const handleSuggestion = (suggestion: string) => {
    if (transport) {
      sendMessage({ text: suggestion })
    }
  }

  return (
    <aside
      className="glass-panel flex h-screen flex-col animate-slide-in-right"
      style={{ width: AI_PANEL_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          <div>
            <h2 className="font-heading text-sm font-semibold">{t('panel.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('panel.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setAIPanelOpen(false)}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Sparkles size={24} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('errors.noProvider')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted">
              <Sparkles size={24} className="text-primary" />
            </div>
            <h3 className="font-heading text-lg font-semibold">{t('panel.empty.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('panel.empty.description')}</p>
            <div className="mt-2 flex flex-col gap-2">
              {(t('panel.empty.suggestions', { returnObjects: true }) as string[]).map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestion(suggestion)}
                    className="glass-card px-3 py-2 text-left text-xs text-muted-foreground hover:border-border-hover hover:text-foreground"
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
                    ? 'ml-auto bg-primary text-primary-foreground'
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
                      <p key={i} className="font-mono text-xs text-muted-foreground">
                        Using tool...
                      </p>
                    )
                  }
                  return null
                })}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {t('panel.thinking')}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
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
