import type { CSSProperties } from 'react'
import {
  Banknote,
  Coins,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { AccountType } from '@/types/common'

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  crypto: Coins,
  other: Wallet,
}

export const ACCOUNT_COLOR_SWATCHES = [
  { value: '#3d6ea8', key: 'blue' },
  { value: '#2a7a78', key: 'teal' },
  { value: '#3d6b4f', key: 'forest' },
  { value: '#a15c3a', key: 'clay' },
  { value: '#6b4c7a', key: 'plum' },
  { value: '#5c6168', key: 'graphite' },
  { value: '#2f6f9e', key: 'ocean' },
  { value: '#8a6a3b', key: 'sand' },
] as const

export function accountAccentColor(color: string | null | undefined): string {
  const value = color?.trim()
  return value ? value : 'var(--color-accent)'
}

export function accountCardSurfaceStyle(
  color: string | null | undefined,
  archived = false
): CSSProperties {
  const value = color?.trim()
  if (!value) return {}
  return {
    backgroundColor: `color-mix(in srgb, ${value} ${archived ? 8 : 14}%, var(--color-surface))`,
    borderColor: `color-mix(in srgb, ${value} 34%, var(--color-border))`,
  }
}

export function toColorPickerValue(color: string | null | undefined): string {
  const value = color?.trim() ?? ''
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, a, b, c] = value
    return `#${a}${a}${b}${b}${c}${c}`
  }
  return '#3d6ea8'
}
