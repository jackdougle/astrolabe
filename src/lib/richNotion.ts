// Notion's note-taking habits for the rendered view: [] at the start of a line makes a to-do, > a toggle and
// " a quote. A toggle is kept in the file as <details><summary>title</summary> ... </details>, which other
// Markdown readers fold the same way.
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model';
import { canJoin, findWrapping } from '@milkdown/kit/prose/transform';
import { $node, $prose, $remark } from '@milkdown/kit/utils';
import type { Cmd } from './richEditing';

// ---------------------------------------------------------------------------------------------------------
// Toggles in the file.

interface Md { type: string; value?: string; open?: boolean; children?: Md[]; position?: unknown }

// Only the plain form is read as a toggle: a title without tags of its own, then the blocks, each set off by a
// blank line. Anything else stays the HTML it is.
const DETAILS_OPEN = /^<details(\s+open(?:=(?:""|''|"open"|'open'))?)?\s*>\s*<summary>([^<]*)<\/summary>$/i;
const DETAILS_CLOSE = /^<\/details>$/i;
const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** For each block in a row, by its HTML (null for other blocks): 1 where a toggle opens, -1 where one closes.
 *  Null when there are none, or when they do not pair up. */
export function toggleMarks(html: (string | null | undefined)[]): number[] | null {
  let depth = 0;
  let any = false;
  let paired = true;
  const marks = html.map((value) => {
    const text = value?.trim();
    if (text && DETAILS_OPEN.test(text)) { depth += 1; any = true; return 1; }
    if (text && DETAILS_CLOSE.test(text)) { depth -= 1; if (depth < 0) paired = false; return -1; }
    return 0;
  });
  return any && paired && depth === 0 ? marks : null;
}

/** A block's HTML, whether it stands alone or has already been put in a paragraph of its own. */
const htmlOf = (node: Md) => (node.type === 'html' ? node.value ?? null
  : node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'html' ? node.children[0].value ?? null : null);

function foldToggles(node: Md) {
  if (!node.children) return;
  node.children.forEach(foldToggles);
  const html = node.children.map(htmlOf);
  const marks = toggleMarks(html);
  if (!marks) return;
  const out: Md[] = [];
  const stack: Md[] = [];
  node.children.forEach((child, i) => {
    const into = stack.length ? stack[stack.length - 1].children! : out;
    if (marks[i] === 1) {
      const m = DETAILS_OPEN.exec(html[i]!.trim())!;
      stack.push({ type: 'toggle', open: !!m[1], children: [{ type: 'toggleSummary', value: decode(m[2].trim()) }], position: child.position });
    } else if (marks[i] === -1) {
      const done = stack.pop()!;
      (stack.length ? stack[stack.length - 1].children! : out).push(done);
    } else into.push(child);
  });
  node.children = out;
}
const remarkToggle = $remark('remarkToggle', () => () => (tree: unknown) => { foldToggles(tree as Md); });

const toggleNode = $node('toggle', () => ({
  content: 'toggle_summary block*',
  group: 'block',
  defining: true,
  attrs: { open: { default: true, validate: 'boolean' } },
  parseDOM: [{ tag: 'div[data-type="toggle"]', getAttrs: (dom) => ({ open: (dom as HTMLElement).dataset.open !== 'false' }) }],
  toDOM: (node) => ['div', { class: 'toggle', 'data-type': 'toggle', 'data-open': String(node.attrs.open) }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'toggle',
    runner: (state, node, type) => { state.openNode(type, { open: !!node.open }); state.next(node.children); state.closeNode(); },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'toggle',
    runner: (state, node) => {
      const title = node.firstChild?.type.name === 'toggle_summary' ? node.firstChild.textContent : '';
      state.addNode('html', undefined, `<details${node.attrs.open ? ' open' : ''}>\n<summary>${encode(title)}</summary>`);
      node.forEach((child) => { if (child.type.name !== 'toggle_summary') state.next(child); });
      state.addNode('html', undefined, '</details>');
    },
  },
}));
const toggleSummaryNode = $node('toggle_summary', () => ({
  content: 'text*',
  marks: '',
  defining: true,
  parseDOM: [{ tag: 'div[data-type="toggle-summary"]' }],
  toDOM: () => ['div', { class: 'toggle-summary', 'data-type': 'toggle-summary' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'toggleSummary',
    runner: (state, node, type) => { state.openNode(type); if (node.value) state.addText(node.value as string); state.closeNode(); },
  },
  toMarkdown: { match: (node) => node.type.name === 'toggle_summary', runner: () => { /* written by its toggle */ } },
}));

// ---------------------------------------------------------------------------------------------------------
// Typing.

/** The toggle whose title the caret is in. */
function titleOf(state: EditorState) {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'toggle_summary' || $from.depth < 2) return null;
  const depth = $from.depth - 1;
  return { toggle: $from.node(depth), at: $from.before(depth) };
}

/** Enter in a toggle's title: into the toggle when it is open, on to a new toggle below when it is closed.
 *  A toggle with nothing in it goes back to an ordinary line. */
export const toggleEnter: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  const { paragraph, toggle, toggle_summary: summary } = state.schema.nodes;
  if (!here || !state.selection.empty || !paragraph || !toggle || !summary) return false;
  if (!dispatch) return true;
  const { $from } = state.selection;
  const tr = state.tr;
  const rest = $from.parent.textContent.slice($from.parentOffset);
  const text = rest ? state.schema.text(rest) : null;
  if (!$from.parent.content.size && here.toggle.childCount === 1) {
    tr.replaceWith(here.at, here.at + here.toggle.nodeSize, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, here.at + 1));
  } else if (here.toggle.attrs.open) {
    tr.delete($from.pos, $from.end());
    tr.insert($from.pos + 1, paragraph.create(null, text));
    tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2));
  } else {
    tr.delete($from.pos, $from.end());
    const below = here.at + here.toggle.nodeSize - rest.length;
    tr.insert(below, toggle.create({ open: true }, summary.create(null, text)));
    tr.setSelection(TextSelection.create(tr.doc, below + 2));
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Backspace at the start of a toggle's title takes the toggle away: its title and what it held become ordinary lines. */
export const toggleBackspace: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  const { paragraph } = state.schema.nodes;
  if (!here || !state.selection.empty || state.selection.$from.parentOffset > 0 || !paragraph) return false;
  if (!dispatch) return true;
  const nodes: PMNode[] = [];
  here.toggle.forEach((child, _offset, i) => { nodes.push(i ? child : paragraph.create(null, child.content)); });
  const tr = state.tr.replaceWith(here.at, here.at + here.toggle.nodeSize, nodes);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, here.at + 1)).scrollIntoView());
  return true;
};

/** ⌘Enter in a toggle's title opens or closes it. */
export const toggleOpen: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  if (!here) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup(here.at, undefined, { ...here.toggle.attrs, open: !here.toggle.attrs.open }));
  return true;
};

/** A click on a toggle's arrow (the space left of its title) opens or closes it. */
export function toggleClick(view: EditorView, event: MouseEvent) {
  const el = event.target as HTMLElement;
  if (!view.editable || !el.classList?.contains('toggle')) return false; // the toggle's own box: its text is in elements inside it
  const title = el.firstElementChild?.getBoundingClientRect();
  if (!title || event.clientX > title.left || event.clientY < title.top || event.clientY > title.bottom) return false;
  const $in = view.state.doc.resolve(view.posAtDOM(el, 0));
  for (let d = $in.depth; d > 0; d--) {
    const node = $in.node(d);
    if (node.type.name !== 'toggle') continue;
    view.dispatch(view.state.tr.setNodeMarkup($in.before(d), undefined, { ...node.attrs, open: !node.attrs.open }));
    return true;
  }
  return false;
}

/** The typing rules. They go after the bracket pairs, which first take away the ] they put in. */
export const notionRules = $prose(() => inputRules({ rules: [
  // [] (or [ ] or [x]) opening a line: a to-do. A bullet becomes one; any other line becomes a list of one.
  new InputRule(/^\[([ xX]?)\]$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const { bullet_list: list, list_item: item } = state.schema.nodes;
    if ($start.parent.type.name !== 'paragraph' || !list || !item) return null;
    const checked = match[1].toLowerCase() === 'x';
    const tr = state.tr.delete(start, end);
    const depth = $start.depth - 1;
    const holder = $start.node(depth);
    if (holder.type === item && $start.index(depth) === 0) {
      if (holder.attrs.checked != null) return null;
      return tr.setNodeMarkup($start.before(depth), undefined, { ...holder.attrs, checked });
    }
    const range = tr.doc.resolve(start).blockRange();
    const wrapping = range && findWrapping(range, list);
    if (!range || !wrapping) return null;
    tr.wrap(range, wrapping);
    const at = $start.before();
    const made = tr.doc.nodeAt(at + 1);
    if (made?.type !== item) return null;
    tr.setNodeMarkup(at + 1, undefined, { ...made.attrs, checked });
    // Straight under a list of bullets or to-dos, it joins that list.
    if (tr.doc.resolve(at).nodeBefore?.type === list && canJoin(tr.doc, at)) tr.join(at);
    return tr;
  }),
  // > and a space opening a line: a toggle, with the rest of the line as its title.
  new InputRule(/^>\s$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    const { toggle, toggle_summary: summary } = state.schema.nodes;
    if ($start.parent.type.name !== 'paragraph' || !toggle || !summary) return null;
    const index = $start.index($start.depth - 1);
    if (!$start.node($start.depth - 1).canReplaceWith(index, index + 1, toggle)) return null;
    const rest = $start.parent.textContent.slice(end - $start.start());
    const at = $start.before();
    const tr = state.tr.replaceWith(at, $start.after(), toggle.create({ open: true }, summary.create(null, rest ? state.schema.text(rest) : null)));
    return tr.setSelection(TextSelection.create(tr.doc, at + 2));
  }),
  // " and a space opening a line: a quote (> is the toggle's, as in Notion).
  new InputRule(/^"\s$/, (state, _match, start, end) => {
    const quote = state.schema.nodes.blockquote;
    if (state.doc.resolve(start).parent.type.name !== 'paragraph' || !quote) return null;
    const tr = state.tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    const wrapping = range && findWrapping(range, quote);
    return range && wrapping ? tr.wrap(range, wrapping) : null;
  }),
] }));

/** How deep the closed toggle is that hides this place, or -1 when the place can be seen. */
function hiddenIn($pos: ResolvedPos) {
  for (let d = 1; d <= $pos.depth; d++) {
    const node = $pos.node(d);
    if (node.type.name === 'toggle' && !node.attrs.open && $pos.index(d) > 0) return d;
  }
  return -1;
}
// The caret never rests inside a closed toggle: going down it steps past, otherwise it stops at the end of the title.
const skipClosed = $prose(() => new Plugin({
  appendTransaction(trs, oldState, newState) {
    const sel = newState.selection;
    if (!sel.empty || !trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
    const depth = hiddenIn(sel.$head);
    if (depth < 0) return null;
    let was = oldState.selection.head;
    for (const tr of trs) was = tr.mapping.map(was);
    const title = sel.$head.node(depth).firstChild;
    let next: Selection | null = sel.head > was ? Selection.findFrom(newState.doc.resolve(sel.$head.after(depth)), 1, true) : null;
    if (next && hiddenIn(next.$head) >= 0) next = null;
    if (!next && title) next = TextSelection.create(newState.doc, sel.$head.start(depth) + 1 + title.content.size);
    return next ? newState.tr.setSelection(next) : null;
  },
}));

/** The toggle itself, to add to the editor after its presets. */
export const notion = [toggleSummaryNode, toggleNode, remarkToggle, skipClosed].flat();
