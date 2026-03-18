import { create } from 'zustand'
import {
  suggestCategory as suggestCategoryService,
  learnFromTransaction as learnService,
  getAutoCategorizationRules,
  deleteRule as deleteRuleService,
  type CategorySuggestion,
} from '@/lib/auto-categorize'
import type { CategoryRule } from '@/types/database'

export interface CategoryRuleWithDetails extends CategoryRule {
  category_name?: string
  category_color?: string
}

interface CategorizationState {
  rules: CategoryRuleWithDetails[]
  isLoading: boolean
  loadRules: () => Promise<void>
  suggestCategory: (description: string) => Promise<CategorySuggestion | null>
  learnFromTransaction: (
    description: string,
    categoryId: string,
    subcategoryId?: string | null
  ) => Promise<void>
  deleteRule: (id: string) => Promise<void>
}

export const useCategorizationStore = create<CategorizationState>((set, get) => ({
  rules: [],
  isLoading: false,

  loadRules: async () => {
    set({ isLoading: true })
    try {
      const rules = await getAutoCategorizationRules()
      set({ rules: rules as CategoryRuleWithDetails[] })
    } finally {
      set({ isLoading: false })
    }
  },

  suggestCategory: async (description: string) => {
    return suggestCategoryService(description)
  },

  learnFromTransaction: async (
    description: string,
    categoryId: string,
    subcategoryId?: string | null
  ) => {
    await learnService(description, categoryId, subcategoryId)
    // Refresh rules in background
    get().loadRules()
  },

  deleteRule: async (id: string) => {
    await deleteRuleService(id)
    set({ rules: get().rules.filter((r) => r.id !== id) })
  },
}))
