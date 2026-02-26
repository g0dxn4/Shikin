import { create } from 'zustand'

interface UIState {
  sidebarCollapsed: boolean
  aiPanelOpen: boolean
  toggleSidebar: () => void
  toggleAIPanel: () => void
  setAIPanelOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  aiPanelOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
}))
