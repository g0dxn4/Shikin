import { create } from 'zustand'

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'shikin.sidebar.collapsed'

function getInitialSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // Collapse preference is optional UI state; storage failures must not block navigation.
  }
}

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

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

  recurringDialogOpen: boolean
  editingRecurringId: string | null
  openRecurringDialog: (id?: string) => void
  closeRecurringDialog: () => void

  goalDialogOpen: boolean
  editingGoalId: string | null
  openGoalDialog: (id?: string) => void
  closeGoalDialog: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: getInitialSidebarCollapsed(),
  toggleSidebar: () =>
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed
      persistSidebarCollapsed(sidebarCollapsed)
      return { sidebarCollapsed }
    }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    persistSidebarCollapsed(sidebarCollapsed)
    set({ sidebarCollapsed })
  },

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

  recurringDialogOpen: false,
  editingRecurringId: null,
  openRecurringDialog: (id) => set({ recurringDialogOpen: true, editingRecurringId: id ?? null }),
  closeRecurringDialog: () => set({ recurringDialogOpen: false, editingRecurringId: null }),

  goalDialogOpen: false,
  editingGoalId: null,
  openGoalDialog: (id) => set({ goalDialogOpen: true, editingGoalId: id ?? null }),
  closeGoalDialog: () => set({ goalDialogOpen: false, editingGoalId: null }),
}))
