// Tables in a rendered note. Hovering a table shows a grip beside the row and above the column under the pointer:
// a click on one picks that whole row or column, ⇧-click or a drag along the grips takes in more, and ⌫ or Delete
// then removes what is picked. Right-clicking a cell offers inserting and deleting rows and columns.
//
// Cells are never merged: a GFM table in the file has one cell per column in every row and no way to write a
// cell spanning two, so a merge could not be saved without losing the Markdown.
import { $prose } from '@milkdown/kit/utils';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables';
import { api } from './api';

interface Found { pos: number; node: PMNode; map: TableMap }

/** The table holding `pos`, if any. */
function tableAt(state: EditorState, pos: number): Found | null {
  const $pos = state.doc.resolve(Math.min(pos, state.doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') return { pos: $pos.before(d), node, map: TableMap.get(node) };
  }
  return null;
}

/** The rows and columns the selection covers in its table (a caret counts as its one cell). */
function picked(state: EditorState) {
  const sel = state.selection;
  const t = tableAt(state, sel.from);
  if (!t) return null;
  const start = t.pos + 1;
  let rect: { left: number; right: number; top: number; bottom: number };
  if (sel instanceof CellSelection) rect = t.map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
  else {
    const $from = sel.$from;
    let cellPos = -1;
    for (let d = $from.depth; d > 0; d--) if (/^table_(cell|header)$/.test($from.node(d).type.name)) { cellPos = $from.before(d); break; }
    if (cellPos < 0) return null;
    rect = t.map.findCell(cellPos - start);
  }
  const wholeRows = sel instanceof CellSelection && rect.left === 0 && rect.right === t.map.width;
  const wholeCols = sel instanceof CellSelection && rect.top === 0 && rect.bottom === t.map.height;
  return { t, rect, wholeRows, wholeCols };
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

/** Writes the table back from a grid of cells: the first row is the header row, the rest body rows. A table
 *  needs a body row, so one of empty cells is added when none is left. Returns false when the grid is empty. */
function rebuild(state: EditorState, t: Found, grid: PMNode[][], caret: { row: number; col: number }): Transaction | null {
  const s = state.schema.nodes;
  const tr = state.tr;
  if (!grid.length || !grid[0].length) {
    tr.delete(t.pos, t.pos + t.node.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(t.pos, tr.doc.content.size))));
    return tr.scrollIntoView();
  }
  const as = (cell: PMNode, type: typeof s.table_cell) => (cell.type === type ? cell : type.create(cell.attrs, cell.content, cell.marks));
  if (grid.length === 1) grid.push(grid[0].map((c) => s.table_cell.createAndFill({ alignment: c.attrs.alignment })!));
  const rows = grid.map((cells, i) => (i === 0
    ? s.table_header_row.create(null, cells.map((c) => as(c, s.table_header)))
    : s.table_row.create(null, cells.map((c) => as(c, s.table_cell)))));
  const table = t.node.type.create(t.node.attrs, rows);
  tr.replaceWith(t.pos, t.pos + t.node.nodeSize, table);
  const row = Math.min(caret.row, rows.length - 1);
  const col = Math.min(caret.col, rows[0].childCount - 1);
  let at = t.pos + 1;
  for (let r = 0; r < row; r++) at += rows[r].nodeSize;
  at += 1;
  for (let c = 0; c < col; c++) at += rows[row].child(c).nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return tr.scrollIntoView();
}

const gridOf = (table: PMNode) => { const g: PMNode[][] = []; table.forEach((row) => { const r: PMNode[] = []; row.forEach((c) => r.push(c)); g.push(r); }); return g; };
const blank = (state: EditorState, like: PMNode) => state.schema.nodes.table_cell.createAndFill({ alignment: like.attrs.alignment })!;

type Cmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Deletes the picked rows (`'rows'`), columns (`'cols'`), or whichever the selection covers whole. */
export const deletePicked = (what?: 'rows' | 'cols' | 'table'): Cmd => (state, dispatch) => {
  const p = picked(state);
  if (!p) return false;
  const kind = what ?? (p.wholeRows && p.wholeCols ? 'table' : p.wholeRows ? 'rows' : p.wholeCols ? 'cols' : null);
  if (!kind) return false;
  const { t, rect } = p;
  let grid = gridOf(t.node);
  if (kind === 'table') grid = [];
  else if (kind === 'rows') grid = grid.filter((_, r) => r < rect.top || r >= rect.bottom);
  else grid = grid.map((row) => row.filter((_, c) => c < rect.left || c >= rect.right));
  const caret = kind === 'rows' ? { row: Math.max(0, rect.top - (rect.top >= grid.length ? 1 : 0)), col: rect.left } : { row: rect.top, col: Math.max(0, Math.min(rect.left, (grid[0]?.length ?? 1) - 1)) };
  const tr = rebuild(state, t, grid, caret);
  if (!tr) return false;
  dispatch?.(tr);
  return true;
};

/** Inserts a row above or below, or a column left or right, of the picked cells. */
export const insertAt = (where: 'above' | 'below' | 'left' | 'right'): Cmd => (state, dispatch) => {
  const p = picked(state);
  if (!p) return false;
  const { t, rect } = p;
  const grid = gridOf(t.node);
  let caret: { row: number; col: number };
  if (where === 'above' || where === 'below') {
    const at = where === 'above' ? rect.top : rect.bottom;
    grid.splice(at, 0, grid[0].map((c) => blank(state, c)));
    caret = { row: at, col: rect.left };
  } else {
    const at = where === 'left' ? rect.left : rect.right;
    for (const row of grid) row.splice(at, 0, state.schema.nodes.table_cell.createAndFill({ alignment: null })!); // no alignment of its own, like a column typed in the file
    caret = { row: rect.top, col: at };
  }
  const tr = rebuild(state, t, grid, caret);
  if (!tr) return false;
  dispatch?.(tr);
  return true;
};

/** Picks whole rows `a`..`b` or whole columns `a`..`b` of the table at `tablePos`. */
function pick(view: EditorView, tablePos: number, axis: 'row' | 'col', a: number, b: number) {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return;
  const map = TableMap.get(table);
  const start = tablePos + 1;
  // The first cell of each row, or the top cell of each column; the selection widens them to whole rows or columns.
  const cell = (i: number) => start + (axis === 'row' ? map.map[i * map.width] : map.map[i]);
  const $a = view.state.doc.resolve(cell(a));
  const $b = view.state.doc.resolve(cell(b));
  const sel = axis === 'row' ? CellSelection.rowSelection($a, $b) : CellSelection.colSelection($a, $b);
  view.dispatch(view.state.tr.setSelection(sel));
  view.focus();
}

const GRIP = 'table-grip';

export const tables = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || event.metaKey || event.altKey || event.ctrlKey) return false;
      if (!(view.state.selection instanceof CellSelection)) return false;
      return deletePicked()(view.state, view.dispatch);
    },
    handleDOMEvents: {
      contextmenu(view, event) {
        const cell = (event.target as HTMLElement).closest?.('td, th');
        if (!cell || !view.dom.contains(cell) || !api.app.menu) return false;
        event.preventDefault();
        let pos: number;
        try { pos = view.posAtDOM(cell, 0); } catch { return true; }
        const sel = view.state.selection;
        const inside = sel instanceof CellSelection && sel.ranges.some((r) => pos >= r.$from.pos && pos <= r.$to.pos);
        if (!inside) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
        const p = picked(view.state);
        if (!p) return true;
        const rows = p.rect.bottom - p.rect.top, cols = p.rect.right - p.rect.left;
        const n = (k: number, one: string) => (k > 1 ? `${k} ${one}s` : one);
        void api.app.menu([
          { id: 'above', label: 'Insert Row Above' }, { id: 'below', label: 'Insert Row Below' },
          { id: 'left', label: 'Insert Column Left' }, { id: 'right', label: 'Insert Column Right' },
          null,
          { id: 'rows', label: `Delete ${n(rows, 'Row')}` }, { id: 'cols', label: `Delete ${n(cols, 'Column')}` },
          { id: 'table', label: 'Delete Table' },
        ]).then((choice) => {
          if (!choice) return;
          const run = choice === 'rows' || choice === 'cols' || choice === 'table' ? deletePicked(choice) : insertAt(choice as 'above');
          run(view.state, view.dispatch);
          view.focus();
        });
        return true;
      },
    },
  },
  view(view) {
    // Two grips, fixed to the window, follow the pointer over a table: one left of the row, one above the column.
    const row = document.createElement('div');
    const col = document.createElement('div');
    row.className = `${GRIP} is-row`; col.className = `${GRIP} is-col`;
    row.title = 'Select row (⇧-click or drag for more), then ⌫ to delete';
    col.title = 'Select column (⇧-click or drag for more), then ⌫ to delete';
    document.body.append(row, col);
    let over: { table: HTMLTableElement; tablePos: number; r: number; c: number } | null = null;
    let drag: { axis: 'row' | 'col'; from: number; tablePos: number } | null = null;
    const hide = () => { row.classList.remove('is-on'); col.classList.remove('is-on'); over = null; };

    const locate = (cell: Element) => {
      const table = cell.closest('table') as HTMLTableElement | null;
      if (!table || !view.dom.contains(table)) return null;
      const tr = cell.parentElement as HTMLTableRowElement;
      const r = [...table.querySelectorAll('tr')].indexOf(tr);
      const c = [...tr.children].indexOf(cell);
      let tablePos: number;
      try {
        const t = tableAt(view.state, view.posAtDOM(cell, 0));
        if (!t) return null;
        tablePos = t.pos;
      } catch { return null; }
      return { table, tablePos, r, c, cell: cell as HTMLElement, tr };
    };

    const marked = () => {
      const sel = view.state.selection;
      const p = sel instanceof CellSelection ? picked(view.state) : null;
      row.classList.toggle('is-picked', !!p?.wholeRows && !!over && over.r >= p.rect.top && over.r < p.rect.bottom);
      col.classList.toggle('is-picked', !!p?.wholeCols && !!over && over.c >= p.rect.left && over.c < p.rect.right);
    };

    const move = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target === row || target === col) return;
      const cell = target.closest?.('td, th');
      if (drag) {
        const at = cell && locate(cell);
        if (at && at.tablePos === drag.tablePos) pick(view, drag.tablePos, drag.axis, drag.from, drag.axis === 'row' ? at.r : at.c);
        return;
      }
      if (!cell || !view.editable) {
        // Keep the grips while the pointer crosses the gap between the table and them.
        if (over) {
          const b = over.table.getBoundingClientRect();
          if (e.clientX < b.left - 26 || e.clientX > b.right + 4 || e.clientY < b.top - 24 || e.clientY > b.bottom + 4) hide();
        }
        return;
      }
      const at = locate(cell);
      if (!at) { hide(); return; }
      over = { table: at.table, tablePos: at.tablePos, r: at.r, c: at.c };
      const tb = at.table.getBoundingClientRect();
      const rb = at.tr.getBoundingClientRect();
      const cb = at.cell.getBoundingClientRect();
      row.style.cssText = `left:${tb.left - 14}px;top:${rb.top + 3}px;height:${Math.max(8, rb.height - 6)}px`;
      col.style.cssText = `top:${tb.top - 13}px;left:${cb.left + 3}px;width:${Math.max(8, cb.width - 6)}px`;
      row.classList.add('is-on'); col.classList.add('is-on');
      marked();
    };

    const down = (axis: 'row' | 'col') => (e: MouseEvent) => {
      if (!over || e.button !== 0) return;
      e.preventDefault();
      const i = axis === 'row' ? over.r : over.c;
      const sel = view.state.selection;
      let from = i;
      if (e.shiftKey && sel instanceof CellSelection) {
        const p = picked(view.state);
        if (p && p.t.pos === over.tablePos) from = axis === 'row' ? (i >= p.rect.top ? p.rect.top : p.rect.bottom - 1) : (i >= p.rect.left ? p.rect.left : p.rect.right - 1);
      }
      pick(view, over.tablePos, axis, from, i);
      drag = { axis, from, tablePos: over.tablePos };
      marked();
    };
    const up = () => { drag = null; };
    const onRow = down('row'), onCol = down('col');
    row.addEventListener('mousedown', onRow);
    col.addEventListener('mousedown', onCol);
    // A right-click on a grip opens the same menu as a cell, for the picked rows or columns.
    const menu = (e: MouseEvent) => {
      if (!over) return;
      e.preventDefault();
      const cell = over.table.querySelectorAll('tr')[over.r]?.children[over.c];
      cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
    };
    row.addEventListener('contextmenu', menu);
    col.addEventListener('contextmenu', menu);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    const scroller = view.dom.closest('.markdown');
    scroller?.addEventListener('scroll', hide, { passive: true });
    return {
      update: () => { if (over && !view.dom.contains(over.table)) hide(); else marked(); },
      destroy: () => {
        row.remove(); col.remove();
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        scroller?.removeEventListener('scroll', hide);
      },
    };
  },
}));
