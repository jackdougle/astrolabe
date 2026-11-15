// What the counter in the corner of the editor shows (`WordCount` in EditorPane.tsx): the words and characters of a
// note or a text file. A note is counted as it reads, not as it is written: its Markdown (the #s, the * and _, a
// link's address, the dashes of a list) is left out, so the numbers are the same raw and rendered.

export interface Counts { words: number; chars: number; noSpaces: number; paragraphs: number; minutes: number }

/** Words read in a minute: the average for silent reading of English non-fiction (Brysbaert, 2019). */
const PER_MINUTE = 238;

const FRONT = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const RULE = /^\s*(?:([-*_])(?:[ \t]*\1){2,}|=+)\s*$/;                 // --- *** ___ and the === under a heading
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LINK_DEF = /^\s{0,3}\[[^\]]+\]:\s+\S.*$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const HEADING = /^\s{0,3}#{1,6}\s+/;

const KEPT = 0xE000; // where characters written with a \\ before them wait, out of the way of the rules below

/** A line of a note without its Markdown. */
function plainLine(line: string) {
  return line
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c: string) => String.fromCharCode(KEPT + c.charCodeAt(0))) // \* is a star, not Markdown: set aside until the end
    .replace(/ ?(?:!\[\[[^\]]*\]\]|!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\))/g, '') // pictures
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1') // [[Note|shown]] and [[Note]]
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')                  // [shown](address)
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')                                 // [shown][ref]
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/`+/g, '')
    .replace(/(\*{1,3}|~~)(?=\S)|(?<=\S)(\*{1,3}|~~)/g, '')
    .replace(/(?<![\p{L}\p{N}_])_{1,3}(?=\S)|(?<=\S)_{1,3}(?![\p{L}\p{N}_])/gu, '') // not the _ inside snake_case
    .replace(/[\uE000-\uE07F]/g, (c) => String.fromCharCode(c.charCodeAt(0) - KEPT));
}

/** A note's text as it reads: its Markdown taken away. Headings and list items end up as blocks of their own, with
 *  a blank line before each, so that they count as paragraphs. Code keeps every character. */
export function plain(md: string) {
  const out: string[] = [];
  let fence: string | null = null;
  const body = md.replace(FRONT, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const raw of body.split(/\r?\n/)) {
    const f = FENCE.exec(raw);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !raw.slice(raw.indexOf(f[1]) + f[1].length).trim()) { fence = null; out.push(''); } else out.push(raw);
      continue;
    }
    if (f) { fence = f[1]; out.push(''); continue; }
    if (RULE.test(raw) || TABLE_RULE.test(raw) || LINK_DEF.test(raw)) { out.push(''); continue; }
    let line = raw.replace(/^\s*(?:>\s?)+/, '');
    const heading = HEADING.test(line);
    const own = heading || ITEM.test(line);
    line = line.replace(HEADING, '').replace(ITEM, '');
    if (/^\s*\|/.test(line)) line = line.split('|').map((cell) => cell.trim()).filter(Boolean).join(' '); // a table's row
    if (own) out.push('');
    out.push(plainLine(line));
    if (heading) out.push('');
  }
  return out.join('\n');
}

const WORD = /[\p{L}\p{N}]/u;

export function count(text: string): Counts {
  let words = 0;
  for (const token of text.split(/[\s—]+/)) if (WORD.test(token)) words += 1; // a dash with no space around it still parts two words
  const line = text.replace(/[\r\n]+/g, '');
  const points = (s: string) => s.length - (s.match(/[\uDC00-\uDFFF]/g)?.length ?? 0); // a character outside the basic plane is one, not two
  let paragraphs = 0;
  for (const block of text.split(/\n[ \t]*(?:\r?\n[ \t]*)+/)) if (WORD.test(block)) paragraphs += 1;
  return { words, chars: points(line), noSpaces: points(line.replace(/\s+/g, '')), paragraphs, minutes: words / PER_MINUTE };
}
