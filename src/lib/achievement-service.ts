import { query } from '@/lib/database'
import {
  assertReportingReadComplete,
  CASH_FLOW_SQL,
  CATEGORY_ALLOCATION_CTE,
} from '@/lib/reporting-read'
import { load } from '@/lib/storage'
import {
  captureReportingContext,
  assertReportingContextCurrent,
  convertReportingAmount,
  readGrossProjection,
  sumReportingAmounts,
  type ReportingContext,
} from '@/lib/dated-reporting-read'
import { readBudgetSpending } from '@/lib/budget-dated-read'
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

// --- Storage keys ---

const STORE_KEY_ACHIEVEMENTS = 'achievements'
const STORE_KEY_STREAK = 'streak'

// --- Persistence helpers ---

async function loadAchievements(): Promise<UnlockedAchievement[]> {
  try {
    const store = await load()
    const raw = await store.get(STORE_KEY_ACHIEVEMENTS)
    if (!raw) return []
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as UnlockedAchievement[])
  } catch {
    return []
  }
}

async function saveAchievements(
  achievements: UnlockedAchievement[],
  context?: ReportingContext
): Promise<void> {
  const store = await load()
  if (context) assertReportingContextCurrent(context)
  await store.set(STORE_KEY_ACHIEVEMENTS, achievements)
}

async function saveStreak(streak: StreakData): Promise<void> {
  const store = await load()
  await store.set(STORE_KEY_STREAK, streak)
}

// --- Streak calculation ---

export async function computeStreak(): Promise<StreakData> {
  const rows = await query<{ d: string }>(
    `SELECT DISTINCT date(t.date) as d FROM transactions t
     WHERE ${CASH_FLOW_SQL}
     ORDER BY d DESC`
  )

  if (rows.length === 0) {
    const streak: StreakData = { currentStreak: 0, longestStreak: 0, lastLoggedDate: null }
    await saveStreak(streak)
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
  await saveStreak(streak)
  return streak
}

// --- Achievement checks ---

async function checkFirstSteps(): Promise<boolean> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM transactions t WHERE ${CASH_FLOW_SQL}`
  )
  return (rows[0]?.cnt ?? 0) >= 1
}

async function checkWeekWarrior(): Promise<boolean> {
  const streak = await computeStreak()
  return streak.currentStreak >= 7 || streak.longestStreak >= 7
}

async function checkBudgetBoss(): Promise<boolean> {
  const context = captureReportingContext()
  if (!context.mainCurrency) return false
  // Check if all active budgets with monthly period are under limit for last completed month
  const lastMonth = dayjs().subtract(1, 'month')
  const start = lastMonth.startOf('month').format('YYYY-MM-DD')
  const end = lastMonth.endOf('month').format('YYYY-MM-DD')

  const budgets = await query<{
    id: string
    category_id: string | null
    amount: number
    currency: string
  }>(
    `SELECT id, category_id, amount, currency FROM budgets WHERE is_active = 1 AND period = 'monthly'`
  )

  if (budgets.length === 0) return false

  await assertReportingReadComplete(start, end)
  for (const b of budgets) {
    const spent = await readBudgetSpending({
      categoryId: b.category_id,
      start,
      end,
      currency: b.currency,
      rates: context.manualRates,
    })
    if (!spent.complete || spent.totalCentavos! > b.amount) return false
  }
  assertReportingContextCurrent(context)
  return true
}

async function checkSavingsStar(): Promise<boolean> {
  const lastMonth = dayjs().subtract(1, 'month')
  const start = lastMonth.startOf('month').format('YYYY-MM-DD')
  const end = lastMonth.endOf('month').format('YYYY-MM-DD')

  const context = captureReportingContext()
  const projection = await readGrossProjection(start, end, context)
  assertReportingContextCurrent(context)
  if (!projection.complete) return false
  const inc = sumReportingAmounts(
    projection.parents.filter((row) => row.type === 'income').map((row) => row.convertedAmount!)
  )
  const exp = sumReportingAmounts(
    projection.parents.filter((row) => row.type === 'expense').map((row) => row.convertedAmount!)
  )
  if (inc <= 0) return false
  return (inc - exp) / inc > 0.2
}

async function checkCenturyClub(): Promise<boolean> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM transactions t WHERE ${CASH_FLOW_SQL}`
  )
  return (rows[0]?.cnt ?? 0) >= 100
}

async function checkDiversified(): Promise<boolean> {
  const start = dayjs().startOf('month').format('YYYY-MM-DD')
  const end = dayjs().format('YYYY-MM-DD')

  await assertReportingReadComplete(start, end)
  const rows = await query<{ cnt: number }>(
    `${CATEGORY_ALLOCATION_CTE}
     SELECT COUNT(DISTINCT t.category_id) as cnt FROM reporting_allocations t
     WHERE t.type = 'expense' AND t.category_id IS NOT NULL AND t.date >= ? AND t.date <= ?
       AND ${CASH_FLOW_SQL}`,
    [start, end]
  )
  return (rows[0]?.cnt ?? 0) >= 5
}

async function checkCurrentStock(type: 'credit_card' | 'savings'): Promise<boolean> {
  const context = captureReportingContext()
  const rows = await query<{ balance: number; currency: string }>(
    'SELECT balance, currency FROM accounts WHERE type = ? AND is_archived = 0',
    [type]
  )
  assertReportingContextCurrent(context)
  return rows.some((row) => {
    try {
      const amount = convertReportingAmount(context, row.balance, row.currency)
      // Keep the original sign-based stock heuristic, but require valid, complete current evidence.
      return (
        amount?.complete === true && (type === 'credit_card' ? row.balance >= 0 : row.balance > 0)
      )
    } catch {
      return false
    }
  })
}
async function checkDebtDestroyer(): Promise<boolean> {
  return checkCurrentStock('credit_card')
}
async function checkGoalGetter(): Promise<boolean> {
  return checkCurrentStock('savings')
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
  const context = captureReportingContext()
  const existing = await loadAchievements()
  try {
    await assertReportingReadComplete()
  } catch {
    // Preserve prior rewards, but never mint new ones from incomplete financial evidence.
    return []
  }
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

  try {
    assertReportingContextCurrent(context)
  } catch {
    return []
  }
  if (newlyUnlocked.length > 0) {
    await saveAchievements([...existing, ...newlyUnlocked], context)
  }

  return newlyUnlocked
}

/**
 * Get all unlocked achievements from the shared store.
 */
export async function getAllAchievements(): Promise<UnlockedAchievement[]> {
  return loadAchievements()
}

/**
 * Dismiss a newly unlocked achievement notification.
 */
export async function dismissAchievement(id: AchievementId): Promise<void> {
  const achievements = await loadAchievements()
  const updated = achievements.map((a) => (a.id === id ? { ...a, dismissed: true } : a))
  await saveAchievements(updated)
}
