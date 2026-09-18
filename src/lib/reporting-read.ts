/** Fixed SQL aliases only. Consumers apply canonical eligibility before using these rows.
 * Allocation integrity travels with every row so grouped reads can fail incomplete.
 */
export const CATEGORY_ALLOCATION_CTE = `WITH reporting_allocations AS (
  SELECT t.type, t.status, t.ledger_treatment, t.reporting_treatment,
         t.transaction_kind, t.is_archived, t.currency, t.date,
         CASE WHEN s.id IS NULL THEN t.category_id ELSE s.category_id END AS category_id,
         COALESCE(s.amount, t.amount) AS amount,
         CASE WHEN EXISTS (SELECT 1 FROM transaction_splits v WHERE v.transaction_id = t.id)
           AND ((SELECT SUM(v.amount) FROM transaction_splits v WHERE v.transaction_id = t.id) != t.amount
             OR EXISTS (SELECT 1 FROM transaction_splits v WHERE v.transaction_id = t.id
                        AND (typeof(v.amount) != 'integer' OR v.amount <= 0)))
           THEN 1 ELSE 0 END AS invalid_allocations
  FROM transactions t LEFT JOIN transaction_splits s ON s.transaction_id = t.id
)`
