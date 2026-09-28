/** Test-owned synthetic USD holding for investment gain-layout E2E. Not a product fixture. */

const BRIDGE_TOKEN = process.env.SHIKIN_DATA_SERVER_BRIDGE_TOKEN || 'shikin-e2e-bridge-token'

export const GAIN_LAYOUT_HOLDING_ID = 'e2e-gain-layout-holding-usd'
export const GAIN_LAYOUT_QUOTE_ID = 'e2e-gain-layout-quote-usd'
export const GAIN_LAYOUT_INSTRUMENT_ID = 'E2E-GAIN-LAYOUT-SYNTH'
export const GAIN_LAYOUT_ASSET_TYPE = 'stock'
export const GAIN_LAYOUT_PROVIDER = 'manual'
export const GAIN_LAYOUT_EXCHANGE = ''
export const GAIN_LAYOUT_CURRENCY = 'USD'
export const GAIN_LAYOUT_INSTRUMENT_KEY = `v1|${[
  GAIN_LAYOUT_ASSET_TYPE,
  GAIN_LAYOUT_PROVIDER,
  GAIN_LAYOUT_INSTRUMENT_ID,
  GAIN_LAYOUT_EXCHANGE,
  GAIN_LAYOUT_CURRENCY,
]
  .map((value) => encodeURIComponent(value))
  .join('|')}`

// Native USD manual quote: 88888 * (123.45 - 12.34) = 9,876,345.68 (900.41%).
export const GAIN_LAYOUT_QUANTITY = '88888'
export const GAIN_LAYOUT_AVG_COST = '12.34'
export const GAIN_LAYOUT_AVG_COST_CENTAVOS = 1234
export const GAIN_LAYOUT_UNIT_PRICE = '123.45'
export const GAIN_LAYOUT_EXPECTED_GAIN_TEXT = '+$9,876,345.68'
export const GAIN_LAYOUT_EXPECTED_PERCENT_TEXT = '(+900.41%)'

function getDataServerUrl() {
  const configuredUrl = process.env.VITE_DATA_SERVER_URL || process.env.SHIKIN_DATA_SERVER_URL
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '')
  }

  return `http://localhost:${process.env.SHIKIN_DATA_SERVER_PORT || '1480'}`
}

function bridgeHeaders() {
  return {
    'Content-Type': 'application/json',
    Origin: process.env.SHIKIN_E2E_ORIGIN || 'http://localhost:1420',
    'X-Shikin-Bridge': BRIDGE_TOKEN,
  }
}

async function queryE2eSql<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const response = await fetch(`${getDataServerUrl()}/api/db/query`, {
    method: 'POST',
    headers: bridgeHeaders(),
    body: JSON.stringify({ sql, params }),
  })
  if (!response.ok) {
    throw new Error(`E2E query failed (${response.status}): ${await response.text()}`)
  }
  return response.json() as Promise<T[]>
}

async function executeE2eSql(
  sql: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number }> {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`${getDataServerUrl()}/api/db/execute`, {
        method: 'POST',
        headers: bridgeHeaders(),
        body: JSON.stringify({ sql, params }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`E2E SQL execute failed (${response.status}): ${body}`)
      }

      return (await response.json()) as { rowsAffected: number }
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message.startsWith('E2E SQL execute failed')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('E2E SQL execute failed')
}

export async function cleanupGainLayoutHoldingFixture() {
  await executeE2eSql('DELETE FROM investments WHERE id = ?', [GAIN_LAYOUT_HOLDING_ID])
  await executeE2eSql('DELETE FROM instrument_prices WHERE id = ? OR instrument_key = ?', [
    GAIN_LAYOUT_QUOTE_ID,
    GAIN_LAYOUT_INSTRUMENT_KEY,
  ])
}

export async function assertGainLayoutHoldingFixtureAbsent() {
  const leftovers = await queryE2eSql<{ id: string }>(
    `SELECT id FROM investments WHERE id = ?
     UNION ALL
     SELECT id FROM instrument_prices WHERE id = ? OR instrument_key = ?`,
    [GAIN_LAYOUT_HOLDING_ID, GAIN_LAYOUT_QUOTE_ID, GAIN_LAYOUT_INSTRUMENT_KEY]
  )
  if (leftovers.length > 0) {
    throw new Error(
      `Owned gain-layout fixture rows remained: ${leftovers.map((row) => row.id).join(', ')}`
    )
  }
}

export async function seedGainLayoutHoldingFixture() {
  await cleanupGainLayoutHoldingFixture()

  const mainCurrency = await queryE2eSql<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'main_currency'"
  )
  if (mainCurrency[0]?.value !== GAIN_LAYOUT_CURRENCY) {
    throw new Error(
      `Gain-layout fixture requires existing ${GAIN_LAYOUT_CURRENCY} main currency, found ${mainCurrency[0]?.value ?? 'unset'}`
    )
  }

  const now = new Date()
  const createdAt = now.toISOString()
  const quoteDate = createdAt.slice(0, 10)

  const holdingInsert = await executeE2eSql(
    `INSERT INTO investments (
       id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes,
       quantity_decimal, avg_cost_basis_decimal, cost_basis_known, instrument_key, created_at, updated_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      GAIN_LAYOUT_HOLDING_ID,
      'E2EGL',
      'E2E Gain Layout Synthetic Holding',
      GAIN_LAYOUT_ASSET_TYPE,
      Number(GAIN_LAYOUT_QUANTITY),
      GAIN_LAYOUT_AVG_COST_CENTAVOS,
      GAIN_LAYOUT_CURRENCY,
      'e2e-gain-layout-owned synthetic manual holding',
      GAIN_LAYOUT_QUANTITY,
      GAIN_LAYOUT_AVG_COST,
      GAIN_LAYOUT_INSTRUMENT_KEY,
      createdAt,
      createdAt,
    ]
  )
  if (holdingInsert.rowsAffected !== 1) {
    throw new Error(`Expected to insert 1 owned holding, affected ${holdingInsert.rowsAffected}`)
  }

  const quoteInsert = await executeE2eSql(
    `INSERT INTO instrument_prices (
       id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency,
       unit_price_decimal, quote_date, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      GAIN_LAYOUT_QUOTE_ID,
      GAIN_LAYOUT_INSTRUMENT_KEY,
      GAIN_LAYOUT_ASSET_TYPE,
      GAIN_LAYOUT_PROVIDER,
      GAIN_LAYOUT_INSTRUMENT_ID,
      GAIN_LAYOUT_EXCHANGE,
      GAIN_LAYOUT_CURRENCY,
      GAIN_LAYOUT_UNIT_PRICE,
      quoteDate,
      createdAt,
    ]
  )
  if (quoteInsert.rowsAffected !== 1) {
    throw new Error(`Expected to insert 1 owned quote, affected ${quoteInsert.rowsAffected}`)
  }

  const holding = await queryE2eSql<{
    id: string
    quantity_decimal: string
    avg_cost_basis_decimal: string
    cost_basis_known: number
    currency: string
    instrument_key: string
  }>(
    `SELECT id, quantity_decimal, avg_cost_basis_decimal, cost_basis_known, currency, instrument_key
     FROM investments WHERE id = ?`,
    [GAIN_LAYOUT_HOLDING_ID]
  )
  const quote = await queryE2eSql<{
    id: string
    instrument_key: string
    provider: string
    instrument_id: string
    quote_currency: string
    unit_price_decimal: string
    quote_date: string
  }>(
    `SELECT id, instrument_key, provider, instrument_id, quote_currency, unit_price_decimal, quote_date
     FROM instrument_prices WHERE id = ?`,
    [GAIN_LAYOUT_QUOTE_ID]
  )

  if (holding.length !== 1 || quote.length !== 1) {
    throw new Error('Owned gain-layout fixture was not persisted')
  }
  if (
    holding[0].quantity_decimal !== GAIN_LAYOUT_QUANTITY ||
    holding[0].avg_cost_basis_decimal !== GAIN_LAYOUT_AVG_COST ||
    Number(holding[0].cost_basis_known) !== 1 ||
    holding[0].currency !== GAIN_LAYOUT_CURRENCY ||
    holding[0].instrument_key !== GAIN_LAYOUT_INSTRUMENT_KEY
  ) {
    throw new Error(`Owned holding metadata mismatch: ${JSON.stringify(holding[0])}`)
  }
  if (
    quote[0].instrument_key !== holding[0].instrument_key ||
    quote[0].provider !== GAIN_LAYOUT_PROVIDER ||
    quote[0].instrument_id !== GAIN_LAYOUT_INSTRUMENT_ID ||
    quote[0].quote_currency !== GAIN_LAYOUT_CURRENCY ||
    quote[0].unit_price_decimal !== GAIN_LAYOUT_UNIT_PRICE ||
    quote[0].quote_date !== quoteDate
  ) {
    throw new Error(`Owned quote identity mismatch: ${JSON.stringify(quote[0])}`)
  }

  return {
    holdingId: holding[0].id,
    quoteId: quote[0].id,
    instrumentKey: holding[0].instrument_key,
    quoteDate,
    expectedGainText: GAIN_LAYOUT_EXPECTED_GAIN_TEXT,
    expectedPercentText: GAIN_LAYOUT_EXPECTED_PERCENT_TEXT,
  }
}
