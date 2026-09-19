import { query, execute, transaction } from './database.js'
import { writeAuditLog } from './tools/shared.js'
import type { RecapRecord } from './insights/shared.js'
export type BasisRecapRecord = Omit<RecapRecord, 'basis'> & {
  basis: 'gross_cashflow' | 'net_consumption'
}
export async function saveBasisRecap(record: BasisRecapRecord): Promise<void> {
  transaction(() => {
    const before = query<BasisRecapRecord & { highlights_json: string }>(
      'SELECT * FROM recaps WHERE type = $1 AND period_start = $2 AND period_end = $3 AND basis = $4 AND currency_scope = $5 ORDER BY generated_at DESC, id DESC LIMIT 1',
      [record.type, record.period_start, record.period_end, record.basis, record.currencyScope]
    )[0]
    const highlights = JSON.stringify(record.highlights)
    if (before) record.id = before.id
    if (
      before &&
      before.title === record.title &&
      before.summary === record.summary &&
      before.highlights_json === highlights
    ) {
      record.generated_at = before.generated_at
      return
    }
    execute(
      'INSERT INTO recaps (id, type, period_start, period_end, title, summary, highlights_json, generated_at, basis, currency_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, highlights_json = excluded.highlights_json, generated_at = excluded.generated_at',
      [
        record.id,
        record.type,
        record.period_start,
        record.period_end,
        record.title,
        record.summary,
        highlights,
        record.generated_at,
        record.basis,
        record.currencyScope,
      ]
    )
    writeAuditLog({
      entity: 'recap',
      entityId: record.id,
      action: before ? 'replace' : 'create',
      before: before ?? null,
      after: record,
      source: 'save-spending-recap',
    })
  })
}
