import { create } from 'zustand'

interface UIState {
  sidebarCollapsed: boolean
  aiPanelOpen: boolean
  toggleSidebar: () => void
  toggleAIPanel: () => void
  setAIPanelOpen: (open: boolean) => void

  accountDialogOpen: boolean
  editingAccountId: string | null
  openAccountDialog: (id?: string) => void
  closeAccountDialog: () => void

  transactionDialogOpen: boolean
  editingTransactionId: string | null
  openTransactionDialog: (id?: string) => void
  closeTransactionDialog: () => void

  budgetDialogOpen: boolean
  editingBudgetId: string | null
  openBudgetDialog: (id?: string) => void
  closeBudgetDialog: () => void

  investmentDialogOpen: boolean
  editingInvestmentId: string | null
  openInvestmentDialog: (id?: string) => void
  closeInvestmentDialog: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  aiPanelOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),

  accountDialogOpen: false,
  editingAccountId: null,
  openAccountDialog: (id) => set({ accountDialogOpen: true, editingAccountId: id ?? null }),
  closeAccountDialog: () => set({ accountDialogOpen: false, editingAccountId: null }),

  transactionDialogOpen: false,
  editingTransactionId: null,
  openTransactionDialog: (id) =>
    set({ transactionDialogOpen: true, editingTransactionId: id ?? null }),
  closeTransactionDialog: () => set({ transactionDialogOpen: false, editingTransactionId: null }),

  budgetDialogOpen: false,
  editingBudgetId: null,
  openBudgetDialog: (id) => set({ budgetDialogOpen: true, editingBudgetId: id ?? null }),
  closeBudgetDialog: () => set({ budgetDialogOpen: false, editingBudgetId: null }),

  investmentDialogOpen: false,
  editingInvestmentId: null,
  openInvestmentDialog: (id) =>
    set({ investmentDialogOpen: true, editingInvestmentId: id ?? null }),
  closeInvestmentDialog: () => set({ investmentDialogOpen: false, editingInvestmentId: null }),
}))
