import { useMemo } from 'react'
import { FixedSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'

export function VirtualTable({ data, columns, rowHeight = 44, height = 400, className = '', emptyMessage = 'No data' }) {
  const rowRenderer = useMemo(
    () => ({ index, style }) => (
      <div style={style} className="flex items-center">
        {columns.map((col, i) => (
          <div key={i} className={`px-4 py-2.5 ${col.align === 'right' ? 'text-right' : ''} ${col.className || ''}`} style={{ width: col.width }}>
            {col.render ? col.render(data[index], index) : data[index][col.key] ?? '-'}
          </div>
        ))}
      </div>
    ),
    [columns, data]
  )

  if (!data.length) {
    return <div className={`py-12 text-center text-slate-400 ${className}`}>{emptyMessage}</div>
  }

  return (
    <div className={`border border-slate-200 rounded-xl overflow-hidden ${className}`} style={{ height }}>
      <AutoSizer disableHeight>
        {({ width }) => (
          <List
            height={height}
            itemCount={data.length}
            itemSize={rowHeight}
            width={width}
            itemData={data}
          >
            {rowRenderer}
          </List>
        )}
      </AutoSizer>
    </div>
  )
}