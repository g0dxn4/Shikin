import { create } from 'zustand'
import type { UIMessage } from 'ai'
import type { AIConversation } from '@/types/database'
import {
  createConversation,
  listConversations,
  deleteConversation,
  saveMessage,
  loadRecentMessages,
  loadOlderMessages,
  generateTitle,
  updateConversationTitle,
} from '@/ai/conversation-persistence'

interface ConversationState {
  currentConversationId: string | null
  conversations: AIConversation[]
  loadedMessageCount: number
  hasOlderMessages: boolean
  isLoading: boolean
  loadConversations: () => Promise<void>
  startNewConversation: (model?: string) => Promise<string>
  switchConversation: (id: string) => Promise<UIMessage[]>
  prependOlderMessages: () => Promise<UIMessage[]>
  persistMessage: (message: UIMessage, conversationId?: string) => Promise<void>
  autoTitle: (firstMessage: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  currentConversationId: null,
  conversations: [],
  loadedMessageCount: 0,
  hasOlderMessages: false,
  isLoading: false,

  loadConversations: async () => {
    set({ isLoading: true })
    try {
      const conversations = await listConversations()
      set({ conversations })
    } catch (err) {
      console.error('[ConversationStore] Failed to load conversations:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  startNewConversation: async (model?: string) => {
    const id = await createConversation(model)
    const conversations = await listConversations()
    set({
      currentConversationId: id,
      conversations,
      loadedMessageCount: 0,
      hasOlderMessages: false,
    })
    return id
  },

  switchConversation: async (id: string) => {
    set({ currentConversationId: id, isLoading: true })
    try {
      const { messages, hasMore, loadedCount } = await loadRecentMessages(id)
      set({
        loadedMessageCount: loadedCount,
        hasOlderMessages: hasMore,
      })
      return messages
    } finally {
      set({ isLoading: false })
    }
  },

  prependOlderMessages: async () => {
    const { currentConversationId, loadedMessageCount } = get()
    if (!currentConversationId) return []

    const { messages, hasMore, loadedCount } = await loadOlderMessages(
      currentConversationId,
      loadedMessageCount
    )

    set({
      loadedMessageCount: loadedCount,
      hasOlderMessages: hasMore,
    })

    return messages
  },

  persistMessage: async (message: UIMessage, conversationId) => {
    const targetConversationId = conversationId || get().currentConversationId
    if (!targetConversationId) return
    await saveMessage(targetConversationId, message)
    set((state) => ({ loadedMessageCount: state.loadedMessageCount + 1 }))
  },

  autoTitle: async (firstMessage: string) => {
    const { currentConversationId } = get()
    if (!currentConversationId) return
    const title = await generateTitle(firstMessage)
    await updateConversationTitle(currentConversationId, title)
    const conversations = await listConversations()
    set({ conversations })
  },

  removeConversation: async (id: string) => {
    const { currentConversationId } = get()
    await deleteConversation(id)
    const conversations = await listConversations()
    set({
      conversations,
      currentConversationId: currentConversationId === id ? null : currentConversationId,
    })
  },
}))
