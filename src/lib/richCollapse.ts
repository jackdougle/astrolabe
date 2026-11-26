// Link notation can become complete through any edit, including typing into the middle of it or pasting
// rich text where the URL is already marked as a link. Collapse it after the edit, not on a particular key.
import { isHistoryTransaction } from '@milkdown/kit/prose/history';
import { Fragment } from '@milkdown/kit/prose/model';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose, $remark } from '@milkdown/kit/utils';
import { webAddress } from './links';
import { hasAutoCloser } from './richEditing';

/** Text that ends with the opening half: [name]( */
const OPENING = /(?<!!)\[([^[\]\n]+)\]\($/;
const plain = (address: string) => { try { return decodeURI(address); } catch { return address; } };
const bare = (address: string) => plain(address).replace(/^(?:https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
/** A link whose words are its own address, as an address typed or pasted bare is. */
const own = (words: string, href: string) => !!words && !!href && bare(words) === bare(href);

interface Md { type: string; value?: string; url?: string; children?: Md[] }
function collapseMd(node: Md) {
  const kids = node.children;
  if (!kids) return;
  for (let i = 1; i < kids.length - 1; i++) {
    const before = kids[i - 1];
    const link = kids[i];
    const after = kids[i + 1];
    if (before.type !== 'text' || after.type !== 'text' || link.type !== 'link' || !after.value?.startsWith(')')) continue;
    const said = link.children?.length === 1 && link.children[0].type === 'text' ? link.children[0].value ?? '' : '';
    const m = OPENING.exec(before.value ?? '');
    if (!m || !own(said, link.url ?? '')) continue;
    before.value = before.value!.slice(0, m.index);
    after.value = after.value.slice(1);
    link.children = [{ type: 'text', value: m[1] }];
  }
  node.children = kids.filter((kid) => !(kid.type === 'text' && kid.value === ''));
  for (const kid of node.children) collapseMd(kid);
}
const remarkCollapse = $remark('remarkCollapseLinks', () => () => (tree: unknown) => { collapseMd(tree as Md); });

/** ProseMirror offsets and string offsets agree even if the address has marks, or there are inline atoms. */
function found(block: PMNode, start: number, state: EditorState) {
  const out: { from: number; to: number; label: Fragment }[] = [];
  const link = state.schema.marks.link;
  if (!link || block.type.spec.code) return out;
  let text = '';
  block.forEach((kid) => { text += kid.isText ? kid.text : '\0'.repeat(kid.nodeSize); });
  for (const m of text.matchAll(/(?<![!\\])\[([^\[\]\n\x00]+)\]\(([^()\s<>\x00]+)\)/g)) {
    const at = m.index!;
    const labelEnd = at + 1 + m[1].length;
    const end = at + m[0].length;
    const href = webAddress(m[2]) ?? (/^(?:mailto:|file:\/\/|\.{1,2}\/|\/(?!\/)|#)/i.test(m[2]) ? m[2] : null);
    if (!href || !m[1].trim()) continue;
    // A generated closer is provisional while the caret is inside its pair. For instance, don't collapse
    // google.co while the user is still typing google.com, or a label before they finish typing its words.
    if (hasAutoCloser(state, start + labelEnd, ']') || hasAutoCloser(state, start + end - 1, ')')) continue;
    if ((text.slice(0, at).split(/(?<!\\)`/).length - 1) % 2) continue;
    let protectedText = false;
    const destStart = labelEnd + 2;
    block.nodesBetween(at, end, (node, off) => {
      if (node.marks.some((mark) => mark.type.spec.code)) protectedText = true;
      const anchor = link.isInSet(node.marks);
      if (anchor && (off < destStart || off + node.nodeSize > end - 1 || !own(m[2], anchor.attrs.href))) protectedText = true;
    });
    if (protectedText) continue;
    const label: PMNode[] = [];
    const mark = link.create({ href });
    block.content.cut(at + 1, labelEnd).forEach((node) => { label.push(node.mark(mark.addToSet(node.marks))); });
    out.push({ from: start + at, to: start + end, label: Fragment.fromArray(label) });
  }
  return out;
}

const collapseEdited = $prose(() => new Plugin({
  appendTransaction(trs, old, state) {
    if (trs.some(isHistoryTransaction)) return null;
    const { doc } = state;
    const hits: ReturnType<typeof found> = [];
    const from = old.doc.content.findDiffStart(doc.content);
    if (from !== null) {
      const to = Math.max(from, old.doc.content.findDiffEnd(doc.content)?.b ?? from);
      doc.nodesBetween(Math.max(0, from - 1), Math.min(to + 1, doc.content.size), (node, pos) => {
        if (!node.isTextblock) return true;
        hits.push(...found(node, pos + 1, state));
        return false;
      });
    } else if (!state.selection.eq(old.selection) && (hasAutoCloser(old, undefined, ')') || hasAutoCloser(old, undefined, ']'))) {
      // Stepping over an auto-closer, or moving out of its pair, only changes the selection.
      const { $head } = old.selection;
      if ($head.parent.isTextblock) hits.push(...found($head.parent, $head.start(), state));
    }
    if (!hits.length) return null;
    const tr = state.tr;
    const head = state.selection.head;
    for (const hit of hits.reverse()) tr.replaceWith(hit.from, hit.to, hit.label);
    if (hits.some((hit) => head > hit.from && head <= hit.to)) tr.removeStoredMark(state.schema.marks.link);
    return tr;
  },
}));

export const collapseLinks = [remarkCollapse, collapseEdited].flat();
