import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../ui-store'

const defaults = {
  sidebarCollapsed: false,
  accountDialogOpen: false,
  editingAccountId: null,
  transactionDialogOpen: false,
  editingTransactionId: null,
}

describe('ui-store', () => {
  beforeEach(() => {
    useUIStore.setState(defaults)
  })

  describe('sidebar', () => {
    it('initializes expanded', () => {
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })

    it('toggleSidebar flips collapsed state', () => {
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    })

    it('toggleSidebar toggles back', () => {
      useUIStore.getState().toggleSidebar()
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })
  })

  describe('account dialog', () => {
    it('initializes closed with null id', () => {
      expect(useUIStore.getState().accountDialogOpen).toBe(false)
      expect(useUIStore.getState().editingAccountId).toBeNull()
    })

    it('openAccountDialog() opens in create mode', () => {
      useUIStore.getState().openAccountDialog()
      expect(useUIStore.getState().accountDialogOpen).toBe(true)
      expect(useUIStore.getState().editingAccountId).toBeNull()
    })

    it('openAccountDialog(id) opens in edit mode', () => {
      useUIStore.getState().openAccountDialog('01ACC001')
      expect(useUIStore.getState().accountDialogOpen).toBe(true)
      expect(useUIStore.getState().editingAccountId).toBe('01ACC001')
    })

    it('closeAccountDialog resets both fields', () => {
      useUIStore.getState().openAccountDialog('01ACC001')
      useUIStore.getState().closeAccountDialog()
      expect(useUIStore.getState().accountDialogOpen).toBe(false)
      expect(useUIStore.getState().editingAccountId).toBeNull()
    })
  })

  describe('transaction dialog', () => {
    it('initializes closed with null id', () => {
      expect(useUIStore.getState().transactionDialogOpen).toBe(false)
      expect(useUIStore.getState().editingTransactionId).toBeNull()
    })

    it('openTransactionDialog() opens in create mode', () => {
      useUIStore.getState().openTransactionDialog()
      expect(useUIStore.getState().transactionDialogOpen).toBe(true)
      expect(useUIStore.getState().editingTransactionId).toBeNull()
    })

    it('openTransactionDialog(id) opens in edit mode', () => {
      useUIStore.getState().openTransactionDialog('01TX001')
      expect(useUIStore.getState().transactionDialogOpen).toBe(true)
      expect(useUIStore.getState().editingTransactionId).toBe('01TX001')
    })

    it('closeTransactionDialog resets both fields', () => {
      useUIStore.getState().openTransactionDialog('01TX001')
      useUIStore.getState().closeTransactionDialog()
      expect(useUIStore.getState().transactionDialogOpen).toBe(false)
      expect(useUIStore.getState().editingTransactionId).toBeNull()
    })
  })
})
