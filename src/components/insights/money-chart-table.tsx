interface MoneyChartTableProps {
  id: string
  caption: string
  columns: readonly string[]
  rows: readonly { key: string; cells: readonly string[] }[]
  visible?: boolean
}

/** Exact full-money alternative for a chart. The wrapper is hidden visually unless `visible`. */
export function MoneyChartTable({
  id,
  caption,
  columns,
  rows,
  visible = false,
}: MoneyChartTableProps) {
  const table = (
    <table id={id} className={visible ? 'w-full min-w-0 text-left text-xs' : undefined}>
      <caption className={visible ? 'text-muted-foreground mb-2 text-left text-xs' : undefined}>
        {caption}
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col" className={visible ? 'px-2 py-1 font-medium' : undefined}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={visible ? 'border-border border-t' : undefined}>
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th
                  key={`${row.key}-${index}`}
                  scope="row"
                  className={visible ? 'px-2 py-1 font-normal' : undefined}
                >
                  {cell}
                </th>
              ) : (
                <td
                  key={`${row.key}-${index}`}
                  className={visible ? 'px-2 py-1 whitespace-nowrap tabular-nums' : undefined}
                >
                  {cell}
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (visible) {
    return <div className="mt-3 max-h-48 min-w-0 overflow-auto">{table}</div>
  }

  return <div className="sr-only">{table}</div>
}
