import { query } from '@/lib/database'
import dayjs from 'dayjs'

// --- Types ---

export type AchievementId =
  | 'first_steps'
  | 'week_warrior'
  | 'budget_boss'
  | 'savings_star'
  | 'century_club'
  | 'diversified'
  | 'debt_destroyer'
  | 'goal_getter'

export interface AchievementDef {
  id: AchievementId
  icon: string
  tier: 'bronze' | 'silver' | 'gold'
}

export interface UnlockedAchievement {
  id: AchievementId
  unlockedAt: string
  dismissed: boolean
}

export interface StreakData {
  currentStreak: number
  longestStreak: number
  lastLoggedDate: string | null
}

// --- Achievement definitions ---

export const ACHIEVEMENTS: Record<AchievementId, AchievementDef> = {
  first_steps: { id: 'first_steps', icon: '\u{1F463}', tier: 'bronze' },
  week_warrior: { id: 'week_warrior', icon: '\u{1F525}', tier: 'bronze' },
  budget_boss: { id: 'budget_boss', icon: '\u{1F451}', tier: 'gold' },
  savings_star: { id: 'savings_star', icon: '\u{2B50}', tier: 'silver' },
  century_club: { id: 'century_club', icon: '\u{1F4AF}', tier: 'silver' },
  diversified: { id: 'diversified', icon: '\u{1F308}', tier: 'bronze' },
  debt_destroyer: { id: 'debt_destroyer', icon: '\u{1F4A5}', tier: 'gold' },
  goal_getter: { id: 'goal_getter', icon: '\u{1F3AF}', tier: 'silver' },
}

// --- localStorage keys ---

const LS_ACHIEVEMENTS = 'valute:achievements'
const LS_STREAK = 'valute:streak'

// --- Persistence helpers ---

function loadAchievements(): UnlockedAchievement[] {
  try {
    const raw = localStorage.getItem(LS_ACHIEVEMENTS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAchievements(achievements: UnlockedAchievement[]): void {
  localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(achievements))
}

function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(LS_STREAK)
    return raw ? JSON.parse(raw) : { currentStreak: 0, longestStreak: 0, lastLoggedDate: null }
  } catch {
    return { currentStreak: 0, longestStreak: 0, lastLoggedDate: null }
  }
}

function saveStreak(streak: StreakData): void {
  localStorage.setItem(LS_STREAK, JSON.stringify(streak))
}

// --- Streak calculation ---

export async function computeStreak(): Promise<StreakData> {
  const rows = await query<{ d: string }>(
    `SELECT DISTINCT date(date) as d FROM transactions ORDER BY d DESC`
  )

  if (rows.length === 0) {
    const streak: StreakData = { currentStreak: 0, longestStreak: 0, lastLoggedDate: null }
    saveStreak(streak)
    return streak
  }

  const dates = rows.map((r) => r.d)
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')

  // Current streak: must include today or yesterday to be "active"
  let currentStreak = 0
  if (dates[0] === today || dates[0] === yesterday) {
    currentStreak = 1
    for (let i = 1; i < dates.length; i++) {
      const expected = dayjs(dates[0]).subtract(i, 'day').format('YYYY-MM-DD')
      if (dates[i] === expected) {
        currentStreak++
      } else {
        break
      }
    }
  }

  // Longest streak: scan all dates
  let longestStreak = dates.length > 0 ? 1 : 0
  let running = 1
  for (let i = 1; i < dates.length; i++) {
    const diff = dayjs(dates[i - 1]).diff(dayjs(dates[i]), 'day')
    if (diff === 1) {
      running++
      if (running > longestStreak) longestStreak = running
    } else {
      running = 1
    }
  }

  const streak: StreakData = {
    currentStreak,
    longestStreak,
    lastLoggedDate: dates[0],
  }
  saveStreak(streak)
  return streak
}

export function getStreak(): StreakData {
  return loadStreak()
}

// --- Achievement checks ---

async function checkFirstSteps(): Promise<boolean> {
  const rows = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM transactions')
  return (rows[0]?.cnt ?? 0) >= 1
}

async function checkWeekWarrior(): Promise<boolean> {
  const streak = await computeStreak()
  return streak.currentStreak >= 7 || streak.longestStreak >= 7
}

async function checkBudgetBoss(): Promise<boolean> {
  // Check if all active budgets with monthly period are under limit for last completed month
  const lastMonth = dayjs().subtract(1, 'month')
  const start = lastMonth.startOf('month').format('YYYY-MM-DD')
  const end = lastMonth.endOf('month').format('YYYY-MM-DD')

  const budgets = await query<{ id: string; category_id: string; amount: number }>(
    `SELECT id, category_id, amount FROM budgets WHERE is_active = 1 AND period = 'monthly'`
  )

  if (budgets.length === 0) return false

  for (const b of budgets) {
    const spent = await query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE category_id = ? AND type = 'expense' AND date >= ? AND date <= ?`,
      [b.category_id, start, end]
    )
    if ((spent[0]?.total ?? 0) > b.amount) return false
  }
  return true
}

async function checkSavingsStar(): Promise<boolean> {
  const lastMonth = dayjs().subtract(1, 'month')
  const start = lastMonth.startOf('month').format('YYYY-MM-DD')
  const end = lastMonth.endOf('month').format('YYYY-MM-DD')

  const income = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND date >= ? AND date <= ?`,
    [start, end]
  )
  const expenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND date >= ? AND date <= ?`,
    [start, end]
  )

  const inc = income[0]?.total ?? 0
  const exp = expenses[0]?.total ?? 0
  if (inc <= 0) return false
  return (inc - exp) / inc > 0.2
}

async function checkCenturyClub(): Promise<boolean> {
  const rows = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM transactions')
  return (rows[0]?.cnt ?? 0) >= 100
}

async function checkDiversified(): Promise<boolean> {
  const start = dayjs().startOf('month').format('YYYY-MM-DD')
  const end = dayjs().format('YYYY-MM-DD')

  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT category_id) as cnt FROM transactions
     WHERE type = 'expense' AND category_id IS NOT NULL AND date >= ? AND date <= ?`,
    [start, end]
  )
  return (rows[0]?.cnt ?? 0) >= 5
}

async function checkDebtDestroyer(): Promise<boolean> {
  // Any credit card with zero or positive balance (paid off)
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM accounts WHERE type = 'credit_card' AND balance >= 0`
  )
  return (rows[0]?.cnt ?? 0) >= 1
}

async function checkGoalGetter(): Promise<boolean> {
  // Check if any savings account has exceeded its initial state (balance > 0)
  // Simple heuristic: savings account with balance > 0 that has income transactions
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM accounts a
     WHERE a.type = 'savings' AND a.balance > 0`
  )
  return (rows[0]?.cnt ?? 0) >= 1
}

// --- Main check function ---

const CHECKERS: Record<AchievementId, () => Promise<boolean>> = {
  first_steps: checkFirstSteps,
  week_warrior: checkWeekWarrior,
  budget_boss: checkBudgetBoss,
  savings_star: checkSavingsStar,
  century_club: checkCenturyClub,
  diversified: checkDiversified,
  debt_destroyer: checkDebtDestroyer,
  goal_getter: checkGoalGetter,
}

/**
 * Scan data and return any newly unlocked achievements.
 * Previously unlocked achievements are not re-checked.
 */
export async function checkAchievements(): Promise<UnlockedAchievement[]> {
  const existing = loadAchievements()
  const unlockedIds = new Set(existing.map((a) => a.id))
  const newlyUnlocked: UnlockedAchievement[] = []

  for (const [id, checker] of Object.entries(CHECKERS)) {
    if (unlockedIds.has(id as AchievementId)) continue
    try {
      const earned = await checker()
      if (earned) {
        const achievement: UnlockedAchievement = {
          id: id as AchievementId,
          unlockedAt: new Date().toISOString(),
          dismissed: false,
        }
        newlyUnlocked.push(achievement)
      }
    } catch {
      // Silently skip failed checks
    }
  }

  if (newlyUnlocked.length > 0) {
    saveAchievements([...existing, ...newlyUnlocked])
  }

  return newlyUnlocked
}

/**
 * Get all unlocked achievements from localStorage.
 */
export function getAllAchievements(): UnlockedAchievement[] {
  return loadAchievements()
}

/**
 * Dismiss a newly unlocked achievement notification.
 */
export function dismissAchievement(id: AchievementId): void {
  const achievements = loadAchievements()
  const updated = achievements.map((a) => (a.id === id ? { ...a, dismissed: true } : a))
  saveAchievements(updated)
}
