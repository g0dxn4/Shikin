// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

dayjs.extend(weekOfYear)

const APP_ID = 'com.asf.shikin'
const tempDirs = new Set<string>()
const cleanupCallbacks = new Set<() => void>()

function currentReviewPath() {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  return `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`
}

function syntheticRoots() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-portfolio-mig-'))
  tempDirs.add(root)
  const home = join(root, 'home')
  const data = join(root, 'data')
  const config = join(root, 'config')
  mkdirSync(home, { recursive: true })
  mkdirSync(data, { recursive: true })
  mkdirSync(config, { recursive: true })
  return { root, home, data, config }
}

function stubApprovedCustomRoot(roots: { home: string; data: string; config: string }) {
  vi.stubEnv('HOME', roots.home)
  vi.stubEnv('XDG_DATA_HOME', roots.data)
  vi.stubEnv('XDG_CONFIG_HOME', roots.config)
  vi.stubEnv('SHIKIN_MIGRATE_LEGACY_DATA', '1')
  vi.stubEnv('SHIKIN_RESPECT_XDG_DATA_HOME', '')
}

async function loadPortfolio(queryImpl?: (sql: string) => unknown[]) {
  vi.resetModules()
  vi.doMock('../database.js', async () => {
    const { prepareStorageForWrite } = await import('../storage-context.js')
    return {
      query: (sql: string) => {
        prepareStorageForWrite()
        if (queryImpl) return queryImpl(sql)
        if (sql.includes('FROM investments')) {
          return [
            {
              id: 'inv',
              account_id: null,
              account_name: null,
              symbol: 'AAPL',
              name: 'Apple',
              type: 'stock',
              shares: 1,
              quantity_decimal: '1',
              avg_cost_basis: 10000,
              avg_cost_basis_decimal: '100',
              cost_basis_known: 1,
              instrument_key: 'v1|stock|manual|AAPL|XNAS|USD',
              currency: 'USD',
              notes: null,
              created_at: '',
              updated_at: '',
              price_instrument_key: 'v1|stock|manual|AAPL|XNAS|USD',
              price_asset_type: 'stock',
              price_provider: 'manual',
              price_instrument_id: 'AAPL',
              price_exchange: 'XNAS',
              price_quote_currency: 'USD',
              unit_price_decimal: '150',
              quote_date: '2026-04-18',
            },
          ]
        }
        return []
      },
      execute: vi.fn(),
      transaction: vi.fn(),
    }
  })
  const portfolio = await import('./portfolio.js')
  cleanupCallbacks.add(() => {
    vi.doUnmock('../database.js')
  })
  return portfolio
}

afterEach(() => {
  for (const cleanup of cleanupCallbacks) cleanup()
  cleanupCallbacks.clear()
  vi.doUnmock('../database.js')
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('portfolio review generation across approved custom-root migration', () => {
  it('does not overwrite a review that appears through lazy migration when force is false', async () => {
    const roots = syntheticRoots()
    const reviewPath = currentReviewPath()
    const legacyReviewDir = join(
      roots.home,
      '.local',
      'share',
      APP_ID,
      'notebook',
      'weekly-reviews'
    )
    mkdirSync(legacyReviewDir, { recursive: true })
    writeFileSync(join(legacyReviewDir, reviewPath.split('/')[1]!), 'existing review')
    stubApprovedCustomRoot(roots)

    const { generatePortfolioReview } = await loadPortfolio()
    const result = await generatePortfolioReview(false)

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      path: reviewPath,
    })
    const migrated = join(roots.data, APP_ID, 'notebook', reviewPath)
    expect(readFileSync(migrated, 'utf-8')).toBe('existing review')
  })

  it('overwrites a migrated review when force is true', async () => {
    const roots = syntheticRoots()
    const reviewPath = currentReviewPath()
    const legacyReviewDir = join(
      roots.home,
      '.local',
      'share',
      APP_ID,
      'notebook',
      'weekly-reviews'
    )
    mkdirSync(legacyReviewDir, { recursive: true })
    writeFileSync(join(legacyReviewDir, reviewPath.split('/')[1]!), 'existing review')
    stubApprovedCustomRoot(roots)

    const { generatePortfolioReview } = await loadPortfolio()
    const result = await generatePortfolioReview(true)

    expect(result).toMatchObject({
      success: true,
      path: reviewPath,
    })
    expect(result).not.toHaveProperty('skipped', true)
    const migrated = join(roots.data, APP_ID, 'notebook', reviewPath)
    const content = readFileSync(migrated, 'utf-8')
    expect(content).toContain('# Portfolio Review')
    expect(content).not.toBe('existing review')
  })

  it('skips without querying when the target review already exists and force is false', async () => {
    const roots = syntheticRoots()
    const reviewPath = currentReviewPath()
    const targetReviewDir = join(roots.data, APP_ID, 'notebook', 'weekly-reviews')
    mkdirSync(targetReviewDir, { recursive: true })
    writeFileSync(join(roots.data, APP_ID, 'notebook', reviewPath), 'already in target')
    stubApprovedCustomRoot(roots)

    let queryCalls = 0
    const { generatePortfolioReview } = await loadPortfolio((sql) => {
      queryCalls += 1
      if (sql.includes('FROM investments')) {
        return [
          {
            symbol: 'AAPL',
            name: 'Apple',
            shares: 1,
            avg_cost_basis: 10000,
            currency: 'USD',
          },
        ]
      }
      return []
    })
    const result = await generatePortfolioReview(false)

    expect(result).toMatchObject({ success: true, skipped: true, path: reviewPath })
    expect(queryCalls).toBe(0)
    expect(readFileSync(join(roots.data, APP_ID, 'notebook', reviewPath), 'utf-8')).toBe(
      'already in target'
    )
    expect(existsSync(join(roots.home, '.local', 'share', APP_ID))).toBe(false)
  })
})
