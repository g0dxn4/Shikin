import {
  z,
  getJsonSetting,
  setJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { stableJsonValue, redactStableJsonValue } from '../data-output.js'

function financeProfileOutput(value: unknown, redacted: boolean): unknown {
  const stable = stableJsonValue(value)
  return redacted ? redactStableJsonValue(stable) : stable
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function deepMergeProfile(
  current: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base = isPlainObject(current) ? current : {}
  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? deepMergeProfile(base[key], value) : value
  }

  return stableJsonValue(merged) as Record<string, unknown>
}

function hasFinanceProfile(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
  )
}

export const financeProfile: ToolDefinition = {
  name: 'finance-profile',
  description:
    'Get, set, or clear stable automation finance profile preferences stored in settings.',
  schema: z.object({
    action: z.enum(['get', 'set', 'clear']).optional().default('get'),
    profile: z
      .object({})
      .passthrough()
      .optional()
      .describe('Profile JSON object to store when action is set'),
    merge: z.boolean().optional().default(true).describe('Merge profile keys when setting'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview profile writes without storing them'),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive free-text finance profile fields in the response'),
  }),
  execute: async ({ action, profile, merge, dryRun, redacted }) => {
    const current = getJsonSetting<unknown>(FINANCE_PROFILE_SETTING_KEY, {})

    if (action === 'get') {
      return {
        success: true,
        action: 'read' as const,
        present: hasFinanceProfile(current),
        profile: financeProfileOutput(current, redacted),
        message: hasFinanceProfile(current)
          ? 'Finance profile is configured.'
          : 'Finance profile is not configured.',
      }
    }

    if (action === 'clear') {
      if (dryRun) {
        return {
          success: true,
          action: 'cleared' as const,
          dryRun: true,
          before: financeProfileOutput(current, redacted),
          after: {},
          message: 'Dry run: finance profile would be cleared.',
        }
      }

      setJsonSetting(FINANCE_PROFILE_SETTING_KEY, {})
      return {
        success: true,
        action: 'cleared' as const,
        present: false,
        profile: {},
        message: 'Finance profile cleared.',
      }
    }

    if (!profile) {
      return { success: false, message: 'profile is required when action is set.' }
    }

    const nextProfile = merge ? deepMergeProfile(current, profile) : stableJsonValue(profile)
    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        before: financeProfileOutput(current, redacted),
        after: financeProfileOutput(nextProfile, redacted),
        message: 'Dry run: finance profile would be updated.',
      }
    }

    setJsonSetting(FINANCE_PROFILE_SETTING_KEY, nextProfile)
    return {
      success: true,
      action: 'updated' as const,
      present: hasFinanceProfile(nextProfile),
      profile: financeProfileOutput(nextProfile, redacted),
      message: 'Finance profile updated.',
    }
  },
}
