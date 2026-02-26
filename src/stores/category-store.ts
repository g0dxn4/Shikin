import { create } from 'zustand'
import { query } from '@/lib/database'
import type { Category } from '@/types/database'

interface CategoryState {
  categories: Category[]
  isLoading: boolean
  fetch: () => Promise<void>
}

export const useCategoryStore = create<CategoryState>((set) => ({
  categories: [],
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true })
    try {
      const categories = await query<Category>('SELECT * FROM categories ORDER BY sort_order ASC')
      set({ categories })
    } finally {
      set({ isLoading: false })
    }
  },
}))
