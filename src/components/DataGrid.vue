<script setup>
/**
 * A list of any length, drawn on a canvas.
 *
 * The catalogue lists used to page: ten rows and a pager, because ten
 * thousand `<v-list-item>`s is a scroll of jank and three quarters of a
 * million is a dead tab. Paging is what a list does when it cannot hold what
 * it is showing. This can: canvas-datagrid draws the rows that are on screen
 * and no others, so the array behind it can be as long as the catalogue is
 * and scrolling costs the same at row 700,000 as at row 7.
 *
 * What it gives back that paging took away is the thing a musician actually
 * does with a catalogue -- run down it. There is no page thirty-four to find
 * your way to; the wheel goes where you were going.
 *
 * Styling is not CSS. The grid paints into a canvas, so every colour has to
 * be handed over as a value -- which means the theme has to be read rather
 * than inherited, and re-read when it changes. @see core/themes.js
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import canvasDatagrid from 'canvas-datagrid'
import { state } from '../store.js'

const props = defineProps({
  /** The rows. May grow while it is on screen. @see store.js streamDrumRows */
  rows: { type: Array, default: () => [] },
  /** `[{ name, title, width }]`, in the order they should appear. */
  columns: { type: Array, default: () => [] },
  /** Which row is chosen, so the grid can mark it. */
  chosen: { type: Object, default: null },
  /** Matched against `chosen` to find the row again. */
  keyed: { type: String, default: 'id' },
})

const emit = defineEmits(['pick', 'use', 'key', 'cell', 'context'])

const box = ref(null)
/** Shallow: the grid owns a canvas and its own event plumbing, and making
    any of that reactive would proxy a great deal of nothing. */
const grid = shallowRef(null)

/**
 * The theme, as the grid takes it.
 *
 * Only the keys that matter -- the component has two hundred and seventeen
 * and most of them are for a spreadsheet. What is set here is what somebody
 * can see: the ground, the ink, the lines between rows, the header, and the
 * two kinds of highlight.
 */
function dress() {
  const one = grid.value
  if (!one) return
  const theme = state.settings.theme
  const ink = theme.fg
  const dim = theme.dim

  Object.assign(one.style, {
    /*
     * Fill the box it is in, rather than grow to fit the data.
     *
     * `auto` is the default and it means "be as tall as the rows need",
     * which for a thousand rows is sixteen thousand pixels -- the largest
     * canvas a browser will paint. The grid then has nothing to scroll,
     * because it is already showing everything, and the wheel does nothing.
     * Measured: a 1344x16384 grid over 13,542px of content.
     */
    height: '100%',
    width: '100%',

    /*
     * Every ground, named.
     *
     * The component has a light default for each of these and only paints
     * the ones it is given, so leaving any out leaves a white strip: the
     * first attempt set the cells and the header and got a white column
     * cap past the last column and a white corner above the row numbers.
     */
    gridBackgroundColor: 'transparent',
    cellBackgroundColor: 'transparent',
    columnHeaderCellCapBackgroundColor: rgba(theme.bg, 0.6),
    cornerCellBackgroundColor: rgba(theme.bg, 0.6),
    activeColumnHeaderCellBackgroundColor: rgba(theme.accent, 0.2),
    activeRowHeaderCellBackgroundColor: rgba(theme.accent, 0.18),
    rowHeaderCellHoverBackgroundColor: rgba(theme.accent, 0.12),
    rowHeaderCellSelectedBackgroundColor: rgba(theme.accent, 0.2),
    activeCellHoverBackgroundColor: rgba(theme.accent, 0.34),
    activeCellSelectedBackgroundColor: rgba(theme.accent, 0.34),
    scrollBarCornerBackgroundColor: 'transparent',
    editCellBackgroundColor: rgba(theme.bg, 0.95),
    editCellColor: ink,
    cellColor: ink,
    cellFont: `12px ${theme.font}`,
    cellPaddingLeft: 10,
    cellPaddingRight: 10,
    cellHeight: 26,
    cellBorderColor: rgba(dim, 0.16),
    cellBorderWidth: 1,

    columnHeaderCellBackgroundColor: rgba(theme.bg, 0.6),
    columnHeaderCellColor: rgba(ink, 0.7),
    columnHeaderCellFont: `11px ${theme.font}`,
    columnHeaderCellBorderColor: rgba(dim, 0.3),
    columnHeaderCellHeight: 26,
    columnHeaderCellHoverBackgroundColor: rgba(theme.accent, 0.14),

    // The row numbers down the side say how far into three quarters of a
    // million you are, which is the thing a pager used to say.
    rowHeaderCellBackgroundColor: rgba(theme.bg, 0.5),
    rowHeaderCellColor: rgba(dim, 0.9),
    rowHeaderCellFont: `10px ${theme.font}`,
    rowHeaderCellBorderColor: rgba(dim, 0.2),

    cellHoverBackgroundColor: rgba(theme.accent, 0.1),
    cellHoverColor: ink,
    cellSelectedBackgroundColor: rgba(theme.accent, 0.26),
    cellSelectedColor: ink,
    activeCellBackgroundColor: rgba(theme.accent, 0.3),
    activeCellColor: ink,
    activeCellBorderColor: theme.accent,
    activeCellOverlayBorderColor: theme.accent,
    selectionOverlayBorderColor: theme.accent,

    scrollBarBackgroundColor: 'transparent',
    scrollBarBoxColor: rgba(dim, 0.45),
    scrollBarBoxBorderColor: 'transparent',
    scrollBarBorderColor: 'transparent',
    scrollBarWidth: 9,
    scrollBarBoxMargin: 2,
    scrollBarBoxMinSize: 24,
  })
}

/** `#rrggbb` with an alpha, which is the only form the grid takes. */
function rgba(hex, alpha) {
  const clean = String(hex || '').trim().replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return `rgba(128,128,128,${alpha})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Which row of the grid holds the chosen thing, or -1. */
function rowOfChosen() {
  const want = props.chosen && props.chosen[props.keyed]
  if (want === undefined || want === null) return -1
  return props.rows.findIndex((row) => row[props.keyed] === want)
}

function build() {
  if (!box.value) return
  grid.value = canvasDatagrid({
    parentNode: box.value,
    schema: props.columns.map((one) => ({ ...one })),
    data: props.rows,
    // A catalogue is read, not written. Editing would let a stray keystroke
    // change a pattern's name in the database.
    editable: false,
    allowColumnReordering: true,
    allowRowReordering: false,
    allowSorting: true,
    showRowNumbers: true,
    showNewRow: false,
    selectionMode: 'row',
    borderDragBehavior: 'resize',
    columnHeaderClickBehavior: 'sort',
  })

  dress()

  /*
   * One click chooses, two uses it -- the same pair as everywhere else in
   * jamin, and the same pair the list it replaces had.
   */
  grid.value.addEventListener('selectionchanged', () => {
    const at = grid.value.activeCell && grid.value.activeCell.rowIndex
    const row = Number.isInteger(at) ? props.rows[at] : null
    if (row) emit('pick', row)
  })

  grid.value.addEventListener('dblclick', (event) => {
    const row = event.cell && event.cell.data
    if (row) emit('use', row)
  })

  /*
   * Which column was clicked, as well as which row.
   *
   * A canvas cannot hold a button, so a control that used to be one -- the
   * heart on a phrase -- becomes a column with a mark in it and a click on
   * that column. The book decides what its columns mean; this only says
   * which one was hit.
   */
  grid.value.addEventListener('click', (event) => {
    const cell = event.cell
    if (!cell || !cell.data || !cell.header) return
    emit('cell', cell.header.name, cell.data)
  })

  grid.value.addEventListener('contextmenu', (event) => {
    const cell = event.cell
    if (!cell || !cell.data) return
    // The grid's own menu is for a spreadsheet -- ordering columns, hiding
    // them. The books use the right button for something of their own.
    event.preventDefault()
    emit('context', cell.data)
  })

  /*
   * The keyboard, which the grid already has: arrows move the active cell,
   * page up and down move a screen, home and end go to the ends. What it
   * does not have is Enter meaning "use this one", which is what it means
   * in every other list in jamin.
   */
  grid.value.addEventListener('keydown', (event) => {
    const at = grid.value.activeCell && grid.value.activeCell.rowIndex
    const row = Number.isInteger(at) ? props.rows[at] : null

    if (event.key === 'Enter') {
      if (row) emit('use', row)
      return
    }

    /*
     * Everything else the book binds, passed up with the row it is about.
     *
     * The list this replaced had its own keydown handler: the digits put a
     * pattern on a numbered part, space puts it on all of them. Those are
     * the book's shortcuts rather than the grid's, and losing them because
     * the list they were attached to went away would be the change taking
     * something without saying so.
     */
    emit('key', event, row)
  })
}

onMounted(build)

/*
 * The array grows while it is being read.
 *
 * `data` is reassigned rather than mutated because that is what tells the
 * grid to remeasure; handing it the same array with more in it leaves the
 * scroll bar describing the length it had when it last looked.
 */
watch(() => props.rows, (rows) => {
  if (grid.value) grid.value.data = rows
})

watch(() => props.columns, (columns) => {
  if (grid.value) grid.value.schema = columns.map((one) => ({ ...one }))
})

/*
 * Chosen from somewhere else -- the map, the dice, a keyboard shortcut. The
 * grid has to agree, and has to bring it into view.
 *
 * Unless it is already there, which is the common case and was a bug: an
 * arrow key moves the active cell, the grid says so, the book records the
 * choice, and this put the active cell back where it had just come from.
 * Two presses of Down landed on row one.
 */
watch(() => props.chosen, () => {
  const one = grid.value
  if (!one) return
  const at = rowOfChosen()
  if (at < 0) return
  const here = one.activeCell && one.activeCell.rowIndex
  if (here === at) return
  one.setActiveCell(0, at)
  one.scrollIntoView(0, at)
})

watch(() => JSON.stringify(state.settings.theme), dress)

onBeforeUnmount(() => {
  const one = grid.value
  grid.value = null
  if (one && one.parentNode) one.parentNode.removeChild(one)
})
</script>

<template>
  <div ref="box" class="jamin-grid"></div>
</template>
