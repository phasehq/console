import clsx from 'clsx'
import { CSSProperties, ReactNode } from 'react'
import { GROUP_HEADER_BG } from './AppSecretGroup'
import { filterEnvSelection } from './EnvSelectionProvider'
import {
  GRID_CELL_BASE,
  GRID_DELETED_LANE,
  GRID_KEY_CELL,
  GRID_ROW_BG,
  GRID_TABLE,
  GRID_TRAILING_CELL,
  GROUP_ACCENT,
  ROW_GUTTER_WIDTH,
  SLIM_COLUMN_WIDTH,
  clampColumnPx,
  gridLayout,
  rowGutterRem,
} from './gridColumns'
import { GridShape } from './gridShape'
import { envColumnId } from '../_hooks/useColumnWidths'
import { GRID_HEADER_BG, GRID_HEADER_BG_SOLID, TH_BASE } from './SecretsGridHeader'

// Text-sized bars, square like the grid: a key or name, and the fainter line of a masked value
const BAR = 'block max-w-full animate-pulse rounded-sm bg-zinc-300 dark:bg-zinc-700'
const VALUE_BAR = 'block max-w-full animate-pulse rounded-sm bg-zinc-300/70 dark:bg-zinc-700/70'
const SLIM_DOT = 'h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500/40'

// Lengths in characters, cycled so rows read as different keys and values
const KEY_CHARS = [18, 12, 22, 15, 9, 20, 14, 24, 11, 17]
const VALUE_CHARS = [28, 14, 36, 20, 8, 32, 18, 24, 12, 40]
// A character of the grid's 12px mono text
const CHAR_REM = 0.47
const chars = (lengths: number[], at: number) => ({
  width: `${lengths[at % lengths.length] * CHAR_REM}rem`,
})

const ROW_NUMBER = 'shrink-0 text-center font-mono text-2xs text-neutral-500'

/** A line of the grid's own text size holding bars, so a row is as tall as the one it stands in for */
const Line = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={clsx('flex items-center text-2xs 2xl:text-xs', className)}>
    {'\u200b'}
    {children}
  </div>
)

type AppSecretsSkeletonProps = {
  shape: GridShape
  /** The checked envs' ids, or null for all of them */
  selectedEnvIds: string[] | null
  viewport: { width: number; rootFontPx: number }
  /** Widths the user dragged, by `envColumnId` and by `keyColumn` */
  columnWidths: Record<string, number>
  keyColumn: string
  /** Env headers carry a drag grip ahead of their checkbox */
  reorderable: boolean
}

/**
 * The grid while its first load is on the way: the same table, columns and row
 * heights the loaded grid will have, with bars where the text goes.
 */
export const AppSecretsSkeleton = ({
  shape,
  selectedEnvIds,
  viewport,
  columnWidths,
  keyColumn,
  reorderable,
}: AppSecretsSkeletonProps) => {
  // An env that is scheduled for deletion is no part of the selection: its column is always slim
  const live = shape.envs.filter((env) => !env.deleted)
  const checkedIds = new Set(filterEnvSelection(live, selectedEnvIds).map((env) => env.id))
  const envs = shape.envs.map((env) => ({
    ...env,
    checked: !env.deleted && checkedIds.has(env.id),
  }))
  const checked = envs.filter((env) => env.checked)

  const gutterRem = rowGutterRem(shape.maxRowNumber)
  const layout = gridLayout({
    checkedCount: checked.length,
    slimCount: envs.length - checked.length,
    viewportWidth: viewport.width,
    rootFontPx: viewport.rootFontPx,
    longestKeyChars: shape.longestKeyChars,
    longestFolderChars: shape.longestFolderChars,
    maxRowDepth: shape.maxRowDepth,
    maxTagCount: shape.maxTagCount,
    gutterRem,
    customWidthsPx: checked.flatMap((env) => {
      const px = columnWidths[envColumnId(env.id, checked.length === 1)]
      return px !== undefined ? [px] : []
    }),
    customKeyPx: columnWidths[keyColumn],
    trailingRem: shape.trailingRem,
  })

  /** One row: its key cell, then a cell per env column from `value` (checked) or a dot (slim) */
  const row = (
    at: number,
    rowBg: string,
    keyCell: ReactNode,
    value: (column: number) => ReactNode,
    accent = false
  ) => (
    <tr key={at} className={rowBg}>
      <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, rowBg, accent && GROUP_ACCENT)}>
        {keyCell}
      </td>
      {envs.map((env, column) => (
        <td key={column} className={clsx(GRID_CELL_BASE, env.deleted && GRID_DELETED_LANE)}>
          {env.checked ? (
            value(column)
          ) : (
            <div className="flex h-8 items-center justify-center">
              {!env.deleted && <span className={SLIM_DOT} />}
            </div>
          )}
        </td>
      ))}
      <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, rowBg)} />
    </tr>
  )

  let rowNumber = 0
  const rows = [...shape.rows].map((kind, at) => {
    if (kind === 'f')
      return row(
        at,
        GRID_ROW_BG,
        <Line className="px-2 py-1.5">
          {/* Past the chevron's place: the folder icon, then its name */}
          <span className="flex min-w-0 items-center gap-1.5 pl-[15px]">
            <span className={clsx(BAR, 'h-3 w-3 shrink-0')} />
            <span className={clsx(BAR, 'h-2.5')} style={chars(KEY_CHARS, at + 4)} />
          </span>
        </Line>,
        () => (
          <div className="flex h-8 items-center justify-center">
            <span className={clsx(VALUE_BAR, 'h-2 w-10')} />
          </div>
        )
      )

    if (kind === 'g')
      return row(
        at,
        GROUP_HEADER_BG,
        <div className="flex h-8 items-center gap-2 px-3">
          <span className={clsx(BAR, 'h-2.5 w-2.5 shrink-0')} />
          <span className={clsx(BAR, 'h-2.5')} style={chars(KEY_CHARS, at + 2)} />
        </div>,
        () => (
          <div className="flex h-8 items-center px-3">
            <span className={clsx(VALUE_BAR, 'h-2 w-28')} />
          </div>
        ),
        true
      )

    rowNumber += 1
    return row(
      at,
      GRID_ROW_BG,
      <div className="flex items-start gap-2 pl-2">
        <span className={clsx(ROW_NUMBER, ROW_GUTTER_WIDTH, 'leading-9')}>{rowNumber}</span>
        {/* The key field's own padding around its line of text */}
        <Line className="min-w-0 flex-1 px-2 py-2">
          <span className={clsx(BAR, 'h-2.5')} style={chars(KEY_CHARS, at)} />
        </Line>
      </div>,
      (column) =>
        kind === 'd' ? (
          // A dynamic key's value is the same few dots in every env
          <div className="flex h-8 items-center justify-center">
            <span className={clsx(VALUE_BAR, 'h-1.5 w-12')} />
          </div>
        ) : (
          <Line className="px-3 py-2">
            <span
              className={clsx(VALUE_BAR, 'h-1.5')}
              style={chars(VALUE_CHARS, at + column * 3)}
            />
          </Line>
        ),
      kind !== 's'
    )
  })

  return (
    // A container, as the grid's scroller is: a lone env's dragged width sizes the key column in cqw
    <div
      className="isolate min-h-0 flex-1 overflow-auto [container-type:inline-size]"
      aria-busy
      aria-label="Loading secrets"
    >
      <table
        aria-hidden
        className={GRID_TABLE}
        style={
          {
            minWidth: layout.tableMinWidth,
            width: layout.tableWidth,
            '--row-gutter': `${gutterRem}rem`,
          } as CSSProperties
        }
      >
        <colgroup>
          <col style={{ width: layout.keyColumnWidth }} />
          {envs.map((env, column) => {
            const custom = env.checked
              ? columnWidths[envColumnId(env.id, checked.length === 1)]
              : undefined
            return (
              <col
                key={column}
                style={
                  !env.checked
                    ? { width: SLIM_COLUMN_WIDTH }
                    : custom !== undefined
                      ? { width: `${clampColumnPx(custom)}px` }
                      : undefined
                }
              />
            )
          })}
          <col style={{ width: `${shape.trailingRem}rem` }} />
        </colgroup>
        <thead>
          <tr>
            <th className={clsx(TH_BASE, GRID_HEADER_BG_SOLID, 'left-0 z-40')}>
              <div className="flex h-9 items-center pl-[calc(1rem+1px+var(--row-gutter,0.9rem))] pr-2">
                <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500 2xl:text-xs">
                  key
                </span>
              </div>
            </th>
            {envs.map((env, column) =>
              env.checked ? (
                <th
                  key={column}
                  className={clsx(TH_BASE, GRID_HEADER_BG, 'z-20')}
                  style={env.color ? { boxShadow: `inset 0 2px 0 ${env.color}` } : undefined}
                >
                  <div className="flex h-9 items-center gap-1.5 px-2">
                    {reorderable && <span className="-ml-1 -mr-0.5 w-3 shrink-0" />}
                    <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-neutral-500/40" />
                    <span className="min-w-0 px-1">
                      <span
                        className={clsx(BAR, 'h-3')}
                        style={{ width: `${env.nameChars * 0.45}rem` }}
                      />
                    </span>
                  </div>
                </th>
              ) : (
                <th key={column} className={clsx(TH_BASE, GRID_HEADER_BG, 'z-20')}>
                  <div
                    className={clsx(
                      'flex h-9 flex-col items-center justify-center gap-1',
                      env.deleted && GRID_DELETED_LANE
                    )}
                  >
                    <span className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-neutral-500/40" />
                    <span className={clsx(VALUE_BAR, 'h-1.5 w-5')} />
                  </div>
                </th>
              )
            )}
            <th className={clsx(TH_BASE, GRID_HEADER_BG, 'z-20 border-l !border-r-0')}>
              <div className="h-9" />
            </th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}
