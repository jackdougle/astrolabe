// Underline (⌘U over selected words) in a rendered note. Markdown has no underline of its own, so the file keeps it
// as <u>words</u>, which other Markdown readers underline too. Remark reads <u> and </u> as two bits of inline HTML;
// `remarkUnderline` pairs them up around what lies between, and the serializer writes the tags back around it.
import { $markSchema, $remark } from '@milkdown/kit/utils';

interface Md { type: string; value?: string; children?: Md[] }
const OPEN = /^<u>$/i;
const CLOSE = /^<\/u>$/i;

function pairUnderlines(node: Md) {
  if (!node.children) return;
  node.children.forEach(pairUnderlines);
  const kids = node.children;
  if (!kids.some((k) => k.type === 'html' && OPEN.test(k.value ?? ''))) return;
  const out: Md[] = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type === 'html' && OPEN.test(k.value ?? '')) {
      const end = kids.findIndex((c, j) => j > i && c.type === 'html' && CLOSE.test(c.value ?? ''));
      if (end > i) {
        const inner: Md = { type: 'underline', children: kids.slice(i + 1, end) };
        pairUnderlines(inner);
        out.push(inner); i = end; continue;
      }
    }
    out.push(k);
  }
  node.children = out;
}
const remarkUnderline = $remark('remarkUnderline', () => () => (tree: unknown) => { pairUnderlines(tree as Md); });

const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (value) => (value === 'underline' ? null : false) }],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => { state.openMark(markType); state.next(node.children); state.closeMark(markType); },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => { state.withMark(mark, 'underline'); },
  },
}));

export const underline = [remarkUnderline, underlineSchema].flat();

/** For remark-stringify's handlers: an underline node is written as <u>…</u>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const underlineHandler = (node: any, _parent: unknown, state: any, info: any) => `<u>${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</u>`;
