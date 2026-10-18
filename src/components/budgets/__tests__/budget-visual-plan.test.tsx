import type * as ScopedResultModule from '@/components/budgets/scoped-result'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@/i18n'
import i18n from '@/i18n'
import type { DisplayBudget } from '@/components/budgets/use-budget-display'
import { formatMoney } from '@/lib/money'
import { BudgetVisualPlan } from '@/components/budgets/budget-visual-plan'
import { BudgetVisualCollection } from '@/components/budgets/budget-visual-collection'

vi.mock('@/components/budgets/scoped-result', async (importOriginal) => {
  const actual = await importOriginal<typeof ScopedResultModule>()
  return {
    ...actual,
    ScopedActualResult: ({
      result,
      compact,
    }: {
      result: { basis?: string; transactionIds?: string[] }
      compact?: boolean
    }) => (
      <div data-evidence-compact={String(!!compact)} data-evidence-basis={result.basis ?? ''}>
        <p>Inspect scope, coverage & money evidence</p>
        <button type="button">
          Inspect contributing transactions · {result.transactionIds?.length ?? 0}
        </button>
      </div>
    ),
  }
})

const references = {
  accounts: [
    {
      id: 'bank',
      name: 'Bank',
      type: 'checking',
      currency: 'USD',
      account_mode: 'transactional',
      is_archived: 0,
    },
  ],
  categories: [{ id: 'food', name: 'Food', color: '#f97316' }],
}

function plan(overrides: Record<string, unknown> = {}): DisplayBudget {
  return {
    id: 'food',
    name: 'Food plan',
    category_id: 'food',
    categoryName: 'Food',
    categoryColor: '#f97316',
    amount: 100000,
    period: 'monthly',
    currency: 'USD',
    is_active: 1,
    limitCentavos: 100000,
    spent: 25000,
    remaining: 75000,
    percentUsed: 25,
    comparison: { limitComparable: true },
    result: {
      complete: true,
      basis: 'gross_cashflow',
      currency: 'USD',
      window: { start: '2026-01-01', end: '2026-01-31', timeZone: 'UTC' },
      transactionIds: ['expense'],
      scope: {},
    },
    ...overrides,
  } as DisplayBudget
}

describe('budget visual plan', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('draws a filled ring only for a comparable complete percent and keeps full money', () => {
    render(
      <BudgetVisualPlan
        budget={plan()}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('progressbar')
    expect(ring).toHaveAttribute('data-budget-usage-filled', 'true')
    expect(ring).toHaveAttribute('data-budget-usage-percent', '25')
    expect(ring).toHaveAttribute('data-budget-usage-visual-percent', '25')
    expect(ring.querySelector('[data-budget-usage-arc]')).toHaveAttribute(
      'data-budget-usage-arc',
      '25'
    )
    expect(ring).toHaveAccessibleName(
      /Food plan, Food: 25% used\. Spent \$250\.00 of \$1,000\.00\. Remaining \$750\.00/
    )
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('$750.00')).toBeInTheDocument()
    expect(screen.getByText('On track')).toHaveClass('text-success')
    expect(screen.getByText('On track')).not.toHaveTextContent('%')
    expect(screen.getByText('25%')).toBeInTheDocument()
    const metadata = screen.getByText(/Monthly · Actual gross · USD · 2026-01-01 – 2026-01-31/)
    expect(metadata).toHaveAttribute('data-budget-plan-meta')
    expect(metadata.closest('details')).toBeNull()
    expect(metadata.textContent).not.toContain('UTC')
    const track = document.querySelector('[data-budget-usage-track]')
    expect(track).toHaveClass('h-2', 'w-full')
    expect(track).toHaveAttribute('data-budget-usage-track-visual-percent', '25')
    expect(track).toHaveAttribute('data-budget-usage-track-tone', 'success')
    expect(track?.querySelector('[data-budget-usage-track-fill]')?.getAttribute('style')).toContain(
      '25%'
    )
    expect(document.querySelector('[data-budget-plan-name]')?.className).toContain('break-words')
    expect(document.querySelector('[data-budget-plan-name]')?.className).not.toContain('anywhere')
    expect(
      document
        .querySelector('[data-budget-plan-actions]')
        ?.contains(document.querySelector('[data-budget-plan-name]'))
    ).toBe(false)
    const details = screen.getByText('Details & evidence').closest('details')
    expect(details).toHaveTextContent('Inspect scope, coverage & money evidence')
    expect(details).not.toHaveAttribute('open')
    expect(document.querySelector('[data-evidence-compact="true"]')).toHaveAttribute(
      'data-evidence-basis',
      'gross_cashflow'
    )
  })

  it('caps the ring above 100 and keeps the exact percent and over amount', async () => {
    const user = userEvent.setup()
    render(
      <BudgetVisualPlan
        budget={plan({
          id: 'over',
          name: 'Travel plan',
          currency: 'EUR',
          limitCentavos: 10000,
          spent: 14000,
          remaining: -4000,
          percentUsed: 140,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('progressbar')
    expect(ring).toHaveAttribute('data-budget-usage-percent', '140')
    expect(ring).toHaveAttribute('data-budget-usage-visual-percent', '100')
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '140%')
    expect(ring.querySelector('[data-budget-usage-arc]')).toHaveAttribute(
      'data-budget-usage-arc',
      '100'
    )
    expect(screen.getByText('140%')).toBeInTheDocument()
    expect(screen.getByText(formatMoney(14000, 'EUR'))).toBeInTheDocument()
    expect(screen.getByText(formatMoney(10000, 'EUR'))).toBeInTheDocument()
    expect(screen.getByText(formatMoney(-4000, 'EUR'))).toHaveClass('text-destructive')
    expect(screen.getByText('Over €40.00')).toHaveClass('text-destructive')
    expect(screen.getByText('Over €40.00')).not.toHaveTextContent('140%')
    const track = document.querySelector('[data-budget-usage-track]')
    expect(track).toHaveAttribute('data-budget-usage-track-visual-percent', '100')
    expect(track).toHaveAttribute('data-budget-usage-track-tone', 'destructive')
    expect(track?.querySelector('[data-budget-usage-track-fill]')?.getAttribute('style')).toContain(
      '100%'
    )
    const details = screen.getByText('Details & evidence').closest('details')
    expect(details).toHaveTextContent(/ring stops at 100%/)
    expect(screen.getByText(/ring stops at 100%/).closest('details')).toBe(details)
    await user.click(screen.getByText('Details & evidence'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Inspect scope, coverage & money evidence')).toBeInTheDocument()
  })

  it('shows an em dash and no arc when the limit is not comparable', () => {
    const { container } = render(
      <BudgetVisualPlan
        budget={plan({
          comparison: { limitComparable: false },
          percentUsed: 90,
          limitCentavos: null,
          remaining: null,
          spent: 25000,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('img', { name: /usage unavailable/i })
    expect(ring).toHaveAttribute('data-budget-usage-filled', 'false')
    expect(ring.querySelector('[data-budget-usage-arc]')).toBeNull()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(document.querySelector('[data-budget-usage-track-fill]')).toBeNull()
    expect(container.querySelector('[style*="width"]')).toBeNull()
    expect(screen.getByText('Usage unavailable')).toBeInTheDocument()
    expect(screen.getByText(/This range spans plan periods/)).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('does not fill a ring when the scoped result is incomplete', () => {
    render(
      <BudgetVisualPlan
        budget={plan({
          result: {
            complete: false,
            basis: 'net_consumption',
            currency: 'USD',
            window: { start: '2026-01-01', end: '2026-01-31', timeZone: 'UTC' },
            transactionIds: [],
          },
          percentUsed: 40,
          spent: 40000,
          remaining: 60000,
          limitCentavos: 100000,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('data-budget-usage-filled', 'false')
    expect(document.querySelector('[data-budget-usage-arc]')).toBeNull()
    expect(document.querySelector('[data-budget-usage-track-fill]')).toBeNull()
    expect(screen.getByText('Usage unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/40%/)).not.toBeInTheDocument()
    expect(screen.getByText('Details & evidence').closest('details')).toHaveTextContent(
      'Inspect scope, coverage & money evidence'
    )
    expect(document.querySelector('[data-evidence-basis="net_consumption"]')).toBeInTheDocument()
  })

  it('keeps edit, delete, and inactive copy on the plan', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <BudgetVisualPlan
        budget={plan({ is_active: 0 })}
        references={references}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )
    expect(screen.getByText('Inactive budget · editable for reactivation')).toBeInTheDocument()
    const details = screen.getByText('Details & evidence').closest('details')
    expect(details).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: 'Edit Food plan' }))
    await user.click(screen.getByRole('button', { name: 'Delete Food plan' }))
    await user.click(screen.getByText('Details & evidence'))
    expect(details).toHaveAttribute('open')
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: /Inspect contributing transactions · 1/ })
    ).toBeInTheDocument()
  })

  it('keeps amount groups and values from shrinking into per-value scrollers', () => {
    render(
      <BudgetVisualPlan
        budget={plan({
          spent: 12700,
          limitCentavos: 15000,
          amount: 15000,
          remaining: 2300,
          percentUsed: 85,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const row = document.querySelector('[data-budget-amounts]')
    expect(row).toHaveClass('flex-wrap', 'min-w-0', 'overflow-x-auto')
    expect(row).toHaveAttribute('tabindex', '0')
    const values = row?.querySelectorAll('dd') ?? []
    expect(values).toHaveLength(3)
    expect(Array.from(values, (value) => value.textContent)).toEqual([
      '$127.00',
      '$150.00',
      '$23.00',
    ])
    for (const value of values) {
      expect(value.className).toContain('shrink-0')
      expect(value.className).toContain('whitespace-nowrap')
      expect(value.className).not.toContain('min-w-0')
      expect(value.className).not.toContain('overflow-x-auto')
      expect(value.className).not.toContain('truncate')
      expect(value.parentElement?.className).toContain('shrink-0')
      expect(value.parentElement?.className).not.toContain('min-w-0')
      expect(value.parentElement?.className).not.toContain('max-w-full')
    }
  })
})

describe('budget visual collection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('does not sum overlapping or mixed-currency plans', () => {
    const usd = plan()
    const overlap = plan({
      id: 'overlap',
      name: 'Dining plan',
      categoryName: 'Dining',
      categoryColor: '#22c55e',
      limitCentavos: 50000,
      amount: 50000,
      spent: 40000,
      remaining: 10000,
      percentUsed: 80,
    })
    const euro = plan({
      id: 'euro',
      name: 'Rent plan',
      categoryName: 'Rent',
      categoryColor: '#3b82f6',
      currency: 'EUR',
      period: 'yearly',
      limitCentavos: 80000,
      amount: 80000,
      spent: 90000,
      remaining: -10000,
      percentUsed: 113,
      result: {
        complete: true,
        basis: 'gross_cashflow',
        currency: 'EUR',
        window: { start: '2026-01-01', end: '2026-12-31', timeZone: 'UTC' },
        transactionIds: [],
        scope: {},
      },
    })
    render(
      <BudgetVisualCollection
        plans={[usd, overlap, euro]}
        visiblePlans={[usd, overlap, euro]}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Add Budget' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Details & evidence')).toHaveLength(3)
    expect(screen.getAllByRole('progressbar')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Plan usage' })).toBeInTheDocument()
    expect(screen.getByText('Independent plans')).toBeInTheDocument()
    const independence = document.querySelector('[data-budget-independence]')
    expect(independence).not.toHaveAttribute('open')
    expect(independence).toHaveTextContent(/Budgets may overlap/)
    expect(independence).toHaveTextContent(/does not sum limits/)
    expect(independence).toHaveTextContent(/no historical plan versions/)
    expect(screen.getByText('3 plans · 1 over plan')).toBeInTheDocument()
    const tracks = document.querySelectorAll('[data-budget-usage-track]')
    expect(tracks).toHaveLength(3)
    expect(tracks[0]).toHaveAttribute('data-budget-usage-track-visual-percent', '25')
    expect(tracks[1]).toHaveAttribute('data-budget-usage-track-visual-percent', '80')
    expect(tracks[2]).toHaveAttribute('data-budget-usage-track-visual-percent', '100')
    expect(
      tracks[2].querySelector('[data-budget-usage-track-fill]')?.getAttribute('style')
    ).toContain('100%')
    for (const amount of [100000, 25000, 75000, 50000, 40000, 10000]) {
      expect(screen.getAllByText(formatMoney(amount, 'USD')).length).toBeGreaterThan(0)
    }
    for (const amount of [80000, 90000, -10000]) {
      expect(screen.getByText(formatMoney(amount, 'EUR'))).toBeInTheDocument()
    }
    const text = document.body.textContent ?? ''
    for (const summed of [150000, 65000, 85000, 115000, 180000]) {
      expect(text).not.toContain(formatMoney(summed, 'USD'))
      expect(text).not.toContain(formatMoney(summed, 'EUR'))
    }
    expect(screen.queryByText(/Total Budgeted|Total Spent|Total Remaining/)).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-budget-usage-arc]')).toHaveLength(3)
  })
})

interface AmountGroupGeometry {
  label: string
  text: string
  ddWidth: number
  ddClientWidth: number
  ddScrollWidth: number
  ddFlexShrink: string
  ddOverflowX: string
  ddWhiteSpace: string
  ddTextOverflow: string
  groupLeft: number
  groupRight: number
  groupTop: number
  insideRow: boolean
  emphasis: boolean
}

interface FrameGeometry {
  id: string
  innerWidth: number
  routePad: string
  panelPad: string
  rowClientWidth: number
  rowScrollWidth: number
  rowFlexWrap: string
  rowOverflowX: string
  tabIndex: number
  groups: AmountGroupGeometry[]
  mainClientWidth: number
  mainScrollWidth: number
  docClientWidth: number
  docScrollWidth: number
  ring: number
  trackHeight: number
  summaryHeight: number
  buttons: { width: number; height: number }[]
}

interface PanGeometry {
  id: string
  groups: {
    text: string
    startLeft: number
    startRowLeft: number
    endRight: number
    endRowRight: number
  }[]
}

interface GeometryReport {
  pageErrors: string[]
  english: FrameGeometry[]
  spanish: FrameGeometry[]
  englishPan: PanGeometry[]
  spanishPan: PanGeometry[]
  wideEnglish: FrameGeometry[]
  wideSpanish: FrameGeometry[]
}

function runGeometryProbe(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`geometry probe timed out\n${stderr}\n${stdout}`))
    }, 75_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`geometry probe exited ${code}\n${stderr}\n${stdout}`))
    })
  })
}

const PROBE_MAIN =
  "import { useEffect, useState } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './probe.css'\nimport '@/i18n'\nimport i18n from '@/i18n'\nimport { BudgetVisualPlan } from '@/components/budgets/budget-visual-plan'\nimport type { DisplayBudget } from '@/components/budgets/use-budget-display'\n\nconst references = { accounts: [], categories: [] }\n\nfunction plan(overrides: Record<string, unknown>): DisplayBudget {\n  return {\n    id: 'probe',\n    name: 'Transport',\n    category_id: 'transport',\n    categoryName: 'Transportation',\n    categoryColor: '#3b82f6',\n    amount: 15000,\n    period: 'monthly',\n    currency: 'USD',\n    is_active: 1,\n    limitCentavos: 15000,\n    spent: 12700,\n    remaining: 2300,\n    percentUsed: 85,\n    comparison: { limitComparable: true },\n    result: {\n      complete: true,\n      basis: 'gross_cashflow',\n      currency: 'USD',\n      groupBy: 'none',\n      window: { start: '2026-10-01', end: '2026-10-31', timeZone: 'America/Chicago' },\n      transactionIds: [],\n      scope: {},\n      budgetUsage: { complete: true, measure: 'expenseCentavos' },\n      known: { expenseCentavos: 12700, incomeCentavos: 0 },\n      totals: { expenseCentavos: 12700, incomeCentavos: 0 },\n      groups: [],\n      nativeTotals: [],\n      coverage: { required: false, complete: true, uncoveredAccountIds: [] },\n      issues: [],\n      repayments: [],\n      conversions: [],\n      unresolvedClassificationIds: [],\n      contributors: [],\n      allocations: [],\n    },\n    ...overrides,\n  } as DisplayBudget\n}\n\nconst scenarios = [\n  {\n    id: 'normal',\n    budget: plan({ id: 'normal', name: 'Transport', categoryName: 'Transportation' }),\n  },\n  {\n    id: 'over',\n    budget: plan({\n      id: 'over',\n      name: 'QA Entertainment',\n      categoryName: 'Entertainment',\n      categoryColor: '#f07474',\n      spent: 21000,\n      limitCentavos: 15000,\n      amount: 15000,\n      remaining: -6000,\n      percentUsed: 140,\n    }),\n  },\n  {\n    id: 'large',\n    budget: plan({\n      id: 'large',\n      name: 'Large figures',\n      categoryName: 'Travel',\n      spent: 123456789012345,\n      limitCentavos: 223456789012345,\n      amount: 223456789012345,\n      remaining: -23456789012345,\n      percentUsed: 140,\n    }),\n  },\n]\n\nfunction Shell({ id, budget }: { id: string; budget: DisplayBudget }) {\n  return (\n    <div id={id} data-probe-frame={id} className=\"bg-background text-foreground\">\n      <div data-probe-shell=\"\" className=\"flex h-[844px] w-[320px] min-w-0 flex-col overflow-hidden\">\n        <main data-probe-main=\"\" className=\"min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain\">\n          <div data-probe-route=\"\" className=\"route-content mx-auto w-full max-w-[1320px] p-4 pb-24\">\n            <section data-probe-panel=\"\" className=\"native-panel min-w-0 px-3 py-2.5\">\n              <ul className=\"min-w-0\">\n                <BudgetVisualPlan\n                  budget={budget}\n                  references={references}\n                  onEdit={() => {}}\n                  onDelete={() => {}}\n                />\n              </ul>\n            </section>\n          </div>\n        </main>\n      </div>\n    </div>\n  )\n}\n\nfunction App() {\n  const [lang, setLang] = useState(i18n.resolvedLanguage || 'en')\n  useEffect(() => {\n    const onChange = (next: string) => setLang(next)\n    i18n.on('languageChanged', onChange)\n    return () => {\n      i18n.off('languageChanged', onChange)\n    }\n  }, [])\n  return (\n    <div data-probe-lang={lang}>\n      {scenarios.map((scenario) => (\n        <Shell key={scenario.id} id={scenario.id} budget={scenario.budget} />\n      ))}\n    </div>\n  )\n}\n\nasync function start() {\n  await i18n.changeLanguage('en')\n  createRoot(document.getElementById('root')!).render(<App />)\n  ;(window as unknown as { __setProbeLang?: (lang: string) => Promise<void> }).__setProbeLang =\n    async (lang: string) => {\n      await i18n.changeLanguage(lang)\n    }\n}\n\nvoid start()\n"

const PROBE_RUNNER =
  "import { createServer } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\nimport { createRequire } from 'node:module'\nimport fs from 'node:fs'\nimport path from 'node:path'\n\nconst probeDir = process.env.PROBE_DIR\nconst repoRoot = process.env.REPO_ROOT\nconst outFile = process.env.GEOMETRY_OUT\nif (!probeDir || !repoRoot || !outFile) throw new Error('missing probe env')\n\nconst require = createRequire(import.meta.url)\nconst { chromium } = require(\n  require.resolve('playwright', { paths: [require.resolve('@playwright/test')] })\n)\n\nfunction readAmountFrames() {\n  const frames = [...document.querySelectorAll('[data-probe-frame]')]\n  return frames.map((frame) => {\n    const main = frame.querySelector('[data-probe-main]')\n    const row = frame.querySelector('[data-budget-amounts]')\n    const route = frame.querySelector('[data-probe-route]')\n    const panel = frame.querySelector('[data-probe-panel]')\n    const ring = frame.querySelector('[role=\"progressbar\"], [role=\"img\"]')\n    const track = frame.querySelector('[data-budget-usage-track]')\n    const summary = frame.querySelector('summary')\n    if (!main || !row || !route || !panel || !ring || !track || !summary) {\n      throw new Error(`incomplete budget frame ${frame.id}`)\n    }\n    row.scrollLeft = 0\n    const rowRect = row.getBoundingClientRect()\n    const groups = [...row.querySelectorAll('dd')].map((dd) => {\n      const group = dd.parentElement\n      if (!group) throw new Error('amount value has no group')\n      const rect = group.getBoundingClientRect()\n      const ddRect = dd.getBoundingClientRect()\n      const ddStyle = getComputedStyle(dd)\n      return {\n        label: group.querySelector('dt')?.textContent ?? '',\n        text: dd.textContent ?? '',\n        ddWidth: ddRect.width,\n        ddClientWidth: dd.clientWidth,\n        ddScrollWidth: dd.scrollWidth,\n        ddFlexShrink: ddStyle.flexShrink,\n        ddOverflowX: ddStyle.overflowX,\n        ddWhiteSpace: ddStyle.whiteSpace,\n        ddTextOverflow: ddStyle.textOverflow,\n        groupLeft: rect.left,\n        groupRight: rect.right,\n        groupTop: rect.top,\n        insideRow:\n          rect.width > 0 && rect.left >= rowRect.left - 1 && rect.right <= rowRect.right + 1,\n        emphasis: dd.classList.contains('text-destructive'),\n      }\n    })\n    return {\n      id: frame.id,\n      innerWidth: window.innerWidth,\n      routePad: getComputedStyle(route).paddingLeft,\n      panelPad: getComputedStyle(panel).paddingLeft,\n      rowClientWidth: row.clientWidth,\n      rowScrollWidth: row.scrollWidth,\n      rowFlexWrap: getComputedStyle(row).flexWrap,\n      rowOverflowX: getComputedStyle(row).overflowX,\n      tabIndex: row.tabIndex,\n      groups,\n      mainClientWidth: main.clientWidth,\n      mainScrollWidth: main.scrollWidth,\n      docClientWidth: document.documentElement.clientWidth,\n      docScrollWidth: document.documentElement.scrollWidth,\n      ring: ring.getBoundingClientRect().width,\n      trackHeight: track.getBoundingClientRect().height,\n      summaryHeight: summary.getBoundingClientRect().height,\n      buttons: [...frame.querySelectorAll('[data-budget-plan-actions] button')].map((button) => {\n        const rect = button.getBoundingClientRect()\n        return { width: rect.width, height: rect.height }\n      }),\n    }\n  })\n}\n\nfunction readAmountPan() {\n  return [...document.querySelectorAll('[data-probe-frame]')].map((frame) => {\n    const row = frame.querySelector('[data-budget-amounts]')\n    if (!row) throw new Error(`missing amount row ${frame.id}`)\n    const groups = [...row.querySelectorAll('dd')].map((dd) => {\n      if (!dd.parentElement) throw new Error('amount value has no group')\n      return dd.parentElement\n    })\n    row.scrollLeft = 0\n    const start = groups.map((group) => {\n      const rect = group.getBoundingClientRect()\n      const rowRect = row.getBoundingClientRect()\n      return {\n        left: rect.left,\n        rowLeft: rowRect.left,\n        text: group.querySelector('dd')?.textContent ?? '',\n      }\n    })\n    row.scrollLeft = row.scrollWidth\n    const end = groups.map((group) => {\n      const rect = group.getBoundingClientRect()\n      const rowRect = row.getBoundingClientRect()\n      return { right: rect.right, rowRight: rowRect.right }\n    })\n    row.scrollLeft = 0\n    return {\n      id: frame.id,\n      groups: start.map((group, index) => ({\n        text: group.text,\n        startLeft: group.left,\n        startRowLeft: group.rowLeft,\n        endRight: end[index]?.right ?? 0,\n        endRowRight: end[index]?.rowRight ?? 0,\n      })),\n    }\n  })\n}\n\nconst server = await createServer({\n  configFile: false,\n  root: probeDir,\n  cacheDir: path.join(probeDir, '.vite-cache'),\n  plugins: [react(), tailwindcss()],\n  resolve: { alias: { '@': path.join(repoRoot, 'src') } },\n  logLevel: 'error',\n  server: {\n    host: '127.0.0.1',\n    port: 0,\n    strictPort: false,\n    fs: { allow: [probeDir, repoRoot] },\n  },\n})\nconst browser = await chromium.launch({\n  headless: true,\n  args: ['--no-sandbox', '--disable-dev-shm-usage'],\n})\nconst pageErrors = []\ntry {\n  await server.listen()\n  const address = server.httpServer?.address()\n  if (!address || typeof address === 'string') throw new Error('geometry probe did not bind a port')\n  const context = await browser.newContext({\n    viewport: { width: 320, height: 844 },\n    locale: 'en-US',\n  })\n  const page = await context.newPage()\n  page.on('pageerror', (error) => pageErrors.push(error.message))\n  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })\n  await page.waitForSelector('#normal [data-budget-amounts]', { timeout: 15000 })\n  const english = await page.evaluate(readAmountFrames)\n  const englishPan = await page.evaluate(readAmountPan)\n  await page.evaluate(async () => {\n    const hook = window.__setProbeLang\n    if (!hook) throw new Error('missing language hook')\n    await hook('es')\n  })\n  await page.waitForFunction(\n    () =>\n      document.querySelector('#normal [data-budget-amounts]')?.textContent?.includes('Gastado') ??\n      false\n  )\n  const spanish = await page.evaluate(readAmountFrames)\n  const spanishPan = await page.evaluate(readAmountPan)\n  await page.setViewportSize({ width: 1280, height: 900 })\n  await page.evaluate(() => {\n    for (const shell of document.querySelectorAll('[data-probe-shell]')) {\n      shell.style.width = '1100px'\n    }\n  })\n  const wideSpanish = await page.evaluate(readAmountFrames)\n  await page.evaluate(async () => {\n    const hook = window.__setProbeLang\n    if (!hook) throw new Error('missing language hook')\n    await hook('en')\n  })\n  await page.waitForFunction(\n    () =>\n      document.querySelector('#normal [data-budget-amounts]')?.textContent?.includes('Spent') ??\n      false\n  )\n  const wideEnglish = await page.evaluate(readAmountFrames)\n  fs.writeFileSync(\n    outFile,\n    JSON.stringify(\n      { pageErrors, english, spanish, englishPan, spanishPan, wideEnglish, wideSpanish },\n      null,\n      2\n    )\n  )\n} finally {\n  await browser.close()\n  await server.close()\n}\n"

async function measureBudgetAmountGeometry(): Promise<GeometryReport> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  const probeDir = mkdtempSync(path.join(tmpdir(), 'budget-amount-geometry-'))
  const outFile = path.join(probeDir, 'geometry.json')
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(probeDir, 'node_modules'))
  writeFileSync(
    path.join(probeDir, 'index.html'),
    `<!doctype html>
<html lang="en" data-appearance="native-dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Budget amount geometry</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`
  )
  writeFileSync(
    path.join(probeDir, 'probe.css'),
    `@import '@/styles/globals.css';
@source '${path.join(repoRoot, 'src')}';
@source '.';
`
  )
  writeFileSync(path.join(probeDir, 'main.tsx'), PROBE_MAIN)
  writeFileSync(path.join(probeDir, 'runner.mjs'), PROBE_RUNNER)
  try {
    await runGeometryProbe(path.join(probeDir, 'runner.mjs'), probeDir, {
      ...process.env,
      PROBE_DIR: probeDir,
      REPO_ROOT: repoRoot,
      GEOMETRY_OUT: outFile,
    })
    const report = JSON.parse(readFileSync(outFile, 'utf8')) as GeometryReport
    const artifactDir = '/tmp/shikin-visual-polish-02/vp-r001'
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(path.join(artifactDir, 'vitest-geometry.json'), JSON.stringify(report, null, 2))
    return report
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

function expectContainedMoney(frame: FrameGeometry, texts: string[], labels: string[]) {
  expect(frame.innerWidth).toBe(320)
  expect(frame.routePad).toBe('16px')
  expect(frame.panelPad).toBe('12px')
  expect(frame.rowClientWidth).toBeGreaterThan(140)
  expect(frame.rowClientWidth).toBeLessThan(220)
  expect(frame.rowFlexWrap).toBe('wrap')
  expect(frame.rowOverflowX).toBe('auto')
  expect(frame.tabIndex).toBe(0)
  expect(frame.mainScrollWidth).toBeLessThanOrEqual(frame.mainClientWidth + 1)
  expect(frame.docScrollWidth).toBeLessThanOrEqual(frame.docClientWidth + 1)
  expect(frame.ring).toBeGreaterThanOrEqual(55)
  expect(frame.ring).toBeLessThanOrEqual(57)
  expect(frame.trackHeight).toBeGreaterThanOrEqual(7)
  expect(frame.trackHeight).toBeLessThanOrEqual(9)
  expect(frame.summaryHeight).toBeGreaterThanOrEqual(44)
  expect(frame.buttons).toHaveLength(2)
  for (const button of frame.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44)
    expect(button.height).toBeGreaterThanOrEqual(44)
  }
  expect(frame.groups.map((group) => group.text)).toEqual(texts)
  expect(frame.groups.map((group) => group.label)).toEqual(labels)
  for (const group of frame.groups) {
    expect(group.ddWidth).toBeGreaterThan(24)
    expect(group.ddClientWidth).toBeGreaterThan(24)
    expect(group.ddScrollWidth).toBeLessThanOrEqual(group.ddClientWidth + 1)
    expect(group.ddFlexShrink).toBe('0')
    expect(group.ddOverflowX).toBe('visible')
    expect(group.ddWhiteSpace).toBe('nowrap')
    expect(group.ddTextOverflow).not.toBe('ellipsis')
    expect(group.insideRow).toBe(true)
  }
  expect(frame.rowScrollWidth).toBeLessThanOrEqual(frame.rowClientWidth + 1)
}

describe('budget amount geometry at 320', () => {
  it('keeps full spent, limit, and remaining visible in English and Spanish', async () => {
    const report = await measureBudgetAmountGeometry()
    expect(report.pageErrors).toEqual([])
    const texts = {
      normal: [formatMoney(12700, 'USD'), formatMoney(15000, 'USD'), formatMoney(2300, 'USD')],
      over: [formatMoney(21000, 'USD'), formatMoney(15000, 'USD'), formatMoney(-6000, 'USD')],
      large: [
        formatMoney(123456789012345, 'USD'),
        formatMoney(223456789012345, 'USD'),
        formatMoney(-23456789012345, 'USD'),
      ],
    }
    const labels = {
      en: ['Spent', 'Limit', 'Remaining'],
      es: ['Gastado', 'L\u00edmite', 'Restante'],
    }
    for (const [frames, language] of [
      [report.english, 'en'],
      [report.spanish, 'es'],
    ] as const) {
      const normal = frames.find((frame) => frame.id === 'normal')
      const over = frames.find((frame) => frame.id === 'over')
      const large = frames.find((frame) => frame.id === 'large')
      expect(normal, language).toBeDefined()
      expect(over, language).toBeDefined()
      expect(large, language).toBeDefined()
      if (!normal || !over || !large) continue
      expectContainedMoney(normal, texts.normal, labels[language])
      expectContainedMoney(over, texts.over, labels[language])
      expect(over.groups[2]?.emphasis).toBe(true)
      expect(normal.groups[2]?.emphasis).toBe(false)
      expect(large.innerWidth).toBe(320)
      expect(large.mainScrollWidth).toBeLessThanOrEqual(large.mainClientWidth + 1)
      expect(large.docScrollWidth).toBeLessThanOrEqual(large.docClientWidth + 1)
      expect(large.groups.map((group) => group.text)).toEqual(texts.large)
      expect(large.groups.map((group) => group.label)).toEqual(labels[language])
      for (const group of large.groups) {
        expect(group.ddWidth).toBeGreaterThan(24)
        expect(group.ddClientWidth).toBeGreaterThan(24)
        expect(group.ddScrollWidth).toBeLessThanOrEqual(group.ddClientWidth + 1)
        expect(group.ddFlexShrink).toBe('0')
        expect(group.ddOverflowX).toBe('visible')
        expect(group.ddTextOverflow).not.toBe('ellipsis')
      }
      expect(large.groups[2]?.emphasis).toBe(true)
    }
    for (const frame of [...report.englishPan, ...report.spanishPan]) {
      expect(frame.groups).toHaveLength(3)
      for (const group of frame.groups) {
        expect(group.startLeft).toBeGreaterThanOrEqual(group.startRowLeft - 1)
        expect(group.endRight).toBeLessThanOrEqual(group.endRowRight + 1)
      }
    }
    for (const frames of [report.wideEnglish, report.wideSpanish]) {
      const normal = frames.find((frame) => frame.id === 'normal')
      expect(normal).toBeDefined()
      if (!normal) continue
      expect(normal.innerWidth).toBe(1280)
      expect(normal.rowScrollWidth).toBeLessThanOrEqual(normal.rowClientWidth + 1)
      expect(normal.docScrollWidth).toBeLessThanOrEqual(normal.docClientWidth + 1)
      const top = normal.groups[0]?.groupTop ?? 0
      for (const group of normal.groups) {
        expect(Math.abs(group.groupTop - top)).toBeLessThanOrEqual(1)
        expect(group.insideRow).toBe(true)
        expect(group.ddScrollWidth).toBeLessThanOrEqual(group.ddClientWidth + 1)
      }
    }
  }, 90_000)
})
