import { EnvironmentType } from '@/apollo/graphql'

/** One environment column in the secrets grid */
export type GridColumn = {
  env: EnvironmentType
  /** Checked envs are full editable columns; unchecked ones collapse to a slim presence column */
  checked: boolean
  /** Still decrypting in the background */
  pending: boolean
}

// Cell contents can only fill their row (h-full) in every browser when the table, rows and
// cells all have a height: Firefox resolves h-full against a bare `td { height: 1px }`.
// Rows still size to their content.
export const GRID_TABLE = 'h-px w-full table-fixed border-separate border-spacing-0 [&_tr]:h-full'
export const GRID_CELL_BASE = 'h-full p-0 border-b border-r border-neutral-500/20'
/** Row background; sticky cells need it too since content scrolls underneath them */
export const GRID_ROW_BG = 'bg-zinc-100 dark:bg-zinc-800'
/** A row's key cell lights up while any cell in the row is hovered (rows are `group`s) */
export const GRID_KEY_ROW_HOVER = 'group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700'
/** Sticky first column (pair with a background); raised while active so its hover menu can rise over the header */
export const GRID_KEY_CELL = 'sticky left-0 z-30 border-l hover:z-[45] focus-within:z-[45]'
/** The last column, after the envs: the new-environment column (`NEW_ENV_CELL`) */
export const GRID_TRAILING_CELL = 'border-l !border-r-0'
/** Marks the cells of the new-environment column: the grid opens the dialog from any of them */
export const NEW_ENV_CELL = { 'data-new-env-cell': '' }
/** Emerald accent shared by rotating/dynamic group headers and their rows */
export const GROUP_ACCENT = 'shadow-[inset_2px_0_0_rgb(16_185_129_/_0.6)]'

// Widths in rem
const KEY_MIN_SINGLE = 10
// Env columns always fit their value's hover menu (seven buttons at most): icon-only
// below xl, labelled (History, Override, Copy) from xl up
const ENV_MIN = 19.5
const ENV_MIN_XL = 28
export const SLIM_COLUMN_WIDTH = '3.75rem'
const SLIM_REM = 3.75
/** Trailing column without the new-environment action */
export const TRAILING_REM = 2.75
/** The new-environment column: "+ New environment", plus a plan label when it's paywalled */
export const NEW_ENV_COLUMN_REM = 10.5
export const NEW_ENV_COLUMN_UPSELL_REM = 13.5
/** Bounds for columns the user drags (key or env); below the defaults is allowed */
export const COLUMN_MIN_PX = 80
export const COLUMN_MAX_PX = 1024

// Keys render in JetBrains Mono (0.6em advance) with tracking-wide (0.025em), so their
// width follows from the character count
const MONO_CHAR_EM = 0.625
// Folder names are Inter; 0.6em per character covers typical lowercase names
const SANS_CHAR_EM = 0.6
// Row number, gaps, cell and input padding, and room for the tag/comment indicators
const KEY_CELL_CHROME_REM = 5.25
// Chevron, folder icon, gaps and padding
const FOLDER_CELL_CHROME_REM = 3.25
// The key's hover menu (type, tags, comment, delete; measured) must fit inside the column. It
// starts after the row number and the row's folder indent; Tags and Comment gain labels at 2xl
const KEY_MENU_REM = 13.75
const KEY_MENU_REM_2XL = 19.875
const KEY_MENU_INSET_REM = 3.125
// The Tags button shows a dot per tag, up to four, then "+N"
const TAG_DOTS_REM = 0.25
const TAG_DOT_REM = 0.5625
const TAG_MORE_REM = 0.75
const KEY_MAX_REM = 30
const BREAKPOINT_XL = 1280
const BREAKPOINT_2XL = 1536

export type GridLayoutInput = {
  checkedCount: number
  slimCount: number
  viewportWidth: number
  rootFontPx: number
  /** Longest key (or dynamic key name) among the shown rows */
  longestKeyChars: number
  /** Longest folder name among the shown folders */
  longestFolderChars: number
  /** Deepest folder level among the shown secret rows */
  maxRowDepth: number
  /** Most tags on any shown key */
  maxTagCount: number
  /** User-set widths of the checked envs that have one (the rest share the space left) */
  customWidthsPx: number[]
  /** User-set key column width, replacing the fitted one */
  customKeyPx?: number
  trailingRem: number
}

/** Width the key column needs for the widest key hover menu on screen */
export const keyMenuFloorRem = (is2xl: boolean, maxTagCount: number, maxRowDepth: number) => {
  const tagDots =
    maxTagCount > 0
      ? TAG_DOTS_REM + Math.min(maxTagCount, 4) * TAG_DOT_REM + (maxTagCount > 4 ? TAG_MORE_REM : 0)
      : 0
  return KEY_MENU_INSET_REM + (is2xl ? KEY_MENU_REM_2XL : KEY_MENU_REM) + tagDots + maxRowDepth
}

/**
 * Column widths for the grid. One checked env lays out like the single-env
 * editor (key ⅓, value ⅔). With more, the key column fits its longest key or
 * folder name; envs the user resized keep their width and the others share
 * the rest, at least ENV_MIN each, scrolling sideways once the viewport can't
 * fit that. When every checked env has a width, the table is exactly as wide
 * as its columns instead of stretching them. A user-set key width replaces the
 * fitted (or ⅓) one in every layout. User widths may go below the defaults.
 */
export const gridLayout = ({
  checkedCount,
  slimCount,
  viewportWidth,
  rootFontPx,
  longestKeyChars,
  longestFolderChars,
  maxRowDepth,
  maxTagCount,
  customWidthsPx,
  customKeyPx,
  trailingRem,
}: GridLayoutInput) => {
  const envMinRem = viewportWidth >= BREAKPOINT_XL ? ENV_MIN_XL : ENV_MIN
  const envMinPx = envMinRem * rootFontPx
  const envsRem = Math.max(checkedCount, 1) * envMinRem
  const fixedRem = slimCount * SLIM_REM + trailingRem
  const is2xl = viewportWidth >= BREAKPOINT_2XL
  const floorRem = keyMenuFloorRem(is2xl, maxTagCount, maxRowDepth)

  // Table columns treat calc()/min() mixing % and lengths as auto, so each width is one unit
  if (checkedCount <= 1 && viewportWidth >= 640) {
    if (customKeyPx !== undefined) {
      const keyPx = clampColumnPx(customKeyPx)
      return {
        keyColumnWidth: `${keyPx}px`,
        tableMinWidth: `calc(${keyPx}px + ${envsRem + fixedRem}rem)`,
        tableWidth: '100%',
        envMinPx,
        resizable: false,
      }
    }
    // The key's third of the table must still hold its hover menu
    const minRem = Math.max((envsRem + fixedRem) / (2 / 3), KEY_MIN_SINGLE * 3, floorRem * 3)
    return {
      keyColumnWidth: '33.333%',
      tableMinWidth: `${Math.ceil(minRem)}rem`,
      tableWidth: '100%',
      envMinPx,
      resizable: false,
    }
  }

  const fontRem = is2xl ? 0.8125 : 0.75
  const contentRem = Math.max(
    KEY_CELL_CHROME_REM + longestKeyChars * fontRem * MONO_CHAR_EM,
    FOLDER_CELL_CHROME_REM + longestFolderChars * fontRem * SANS_CHAR_EM
  )
  const floorPx = floorRem * rootFontPx
  // Long keys stop at 40% of the viewport (or 30rem) so values keep room. The menu floor wins
  // over that cap except on phones, where the menu may overhang the first env column instead.
  const capPx = Math.min(KEY_MAX_REM * rootFontPx, 0.4 * viewportWidth)
  const fittedPx = Math.min(Math.max(contentRem * rootFontPx, floorPx), capPx)
  const keyPx = viewportWidth >= 640 ? Math.max(fittedPx, floorPx) : fittedPx
  // 8px steps: typing a longer key re-lays out the table every few characters, not every one
  const width = customKeyPx !== undefined ? clampColumnPx(customKeyPx) : Math.ceil(keyPx / 8) * 8

  const customPx = customWidthsPx.reduce((sum, px) => sum + clampColumnPx(px), 0)
  const autoCount = Math.max(checkedCount - customWidthsPx.length, 0)
  const tableMinWidth = `calc(${width + customPx}px + ${autoCount * envMinRem + fixedRem}rem)`

  return {
    keyColumnWidth: `${width}px`,
    tableMinWidth,
    tableWidth: autoCount > 0 ? '100%' : tableMinWidth,
    envMinPx,
    resizable: true,
  }
}

/** A user-set column width, within COLUMN_MIN_PX..COLUMN_MAX_PX */
export const clampColumnPx = (px: number) =>
  Math.round(Math.min(Math.max(px, COLUMN_MIN_PX), COLUMN_MAX_PX))

/** Content signature, so rows can reference-compare a memoized column list */
export const columnsSignature = (columns: GridColumn[]) =>
  columns
    .map((c) => [c.env.id, c.env.name, c.env.color, c.checked ? 1 : 0, c.pending ? 1 : 0].join(':'))
    .join(',')
