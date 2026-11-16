// A link that was written out as notation around an address that is itself a link:
//
//     \[Charles Fracchia]\(<https://www.linkedin.com/in/charlesfracchia/>)
//
// This is what a note is left holding when "[name](address)" is pasted as formatted text whose address was already a
// link (copied from a chat, a terminal or a web page): the brackets arrive as plain characters and are saved with
// backslashes. In the rendered view it collapses into the name, linked. It is read that way when the note opens (the
// file is not changed until that block is edited, and then it is written as an ordinary [name](address)), and a
// paste that lands in that shape is put right as it goes in. A picture's ![alt](address) and anything in code are
// left alone, and so is notation around an address that is not a link of its own.
import { Plugin } from '@milkdown/kit/prose/state';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { $prose, $remark } from '@milkdown/kit/utils';

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

/** The places in a text block where notation wraps a link to its own address: what to replace, and with what. */
function found(block: PMNode, start: number) {
  const out: { from: number; to: number; node: PMNode }[] = [];
  const link = block.type.schema.marks.link;
  const code = block.type.schema.marks.inlineCode;
  if (!link || block.type.spec.code) return out;
  let pos = start;
  for (let i = 0; i < block.childCount; i++) {
    const kid = block.child(i);
    const at = pos;
    pos += kid.nodeSize;
    if (i === 0 || i === block.childCount - 1 || !kid.isText) continue;
    const mark = link.isInSet(kid.marks);
    const before = block.child(i - 1);
    const after = block.child(i + 1);
    if (!mark || !before.isText || !after.isText || !after.text!.startsWith(')') || link.isInSet(before.marks) || (code && code.isInSet(before.marks))) continue;
    const m = OPENING.exec(before.text!);
    if (!m || !own(kid.text!, mark.attrs.href)) continue;
    out.push({ from: at - (before.text!.length - m.index), to: at + kid.nodeSize + 1, node: block.type.schema.text(m[1], link.create({ href: mark.attrs.href }).addToSet(before.marks)) });
  }
  return out;
}

const collapsePasted = $prose(() => new Plugin({
  appendTransaction(trs, _old, state) {
    // Typing goes in a character at a time and is the link rule's business; this looks only after something larger
    // (a paste, a drop, text put in by a command) has landed.
    if (!trs.some((tr) => tr.docChanged && tr.steps.some((step) => ((step as unknown as { slice?: { size: number } }).slice?.size ?? 0) > 2))) return null;
    const hits: ReturnType<typeof found> = [];
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      if (node.childCount > 2) hits.push(...found(node, pos + 1));
      return false;
    });
    if (!hits.length) return null;
    const tr = state.tr;
    for (const hit of hits.reverse()) tr.replaceWith(hit.from, hit.to, hit.node);
    return tr;
  },
}));

export const collapseLinks = [remarkCollapse, collapsePasted].flat();
