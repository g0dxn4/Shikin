import { create } from 'zustand'
import type { UIMessage } from 'ai'
import type { AIConversation } from '@/types/database'
import {
  createConversation,
  listConversations,
  deleteConversation,
  saveMessage,
  loadMessages,
  generateTitle,
  updateConversationTitle,
} from '@/ai/conversation-persistence'

interface ConversationState {
  currentConversationId: string | null
  conversations: AIConversation[]
  isLoading: boolean
  loadConversations: () => Promise<void>
  startNewConversation: (model?: string) => Promise<string>
  switchConversation: (id: string) => Promise<UIMessage[]>
  persistMessage: (message: UIMessage) => Promise<void>
  autoTitle: (firstMessage: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  currentConversationId: null,
  conversations: [],
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
    set({ currentConversationId: id, conversations })
    return id
  },

  switchConversation: async (id: string) => {
    set({ currentConversationId: id })
    const messages = await loadMessages(id)
    return messages
  },

  persistMessage: async (message: UIMessage) => {
    const { currentConversationId } = get()
    if (!currentConversationId) return
    await saveMessage(currentConversationId, message)
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
