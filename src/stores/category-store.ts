import { create } from 'zustand'
import { query } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import type { Category } from '@/types/database'

interface CategoryState {
  categories: Category[]
  isLoading: boolean
  fetchError: string | null
  fetch: () => Promise<void>
}

export const useCategoryStore = create<CategoryState>((set) => ({
  categories: [],
  isLoading: false,
  fetchError: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const categories = await query<Category>('SELECT * FROM categories ORDER BY sort_order ASC')
      set({ categories, fetchError: null })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },
}))
