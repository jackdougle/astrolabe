// What VS Code's Markdown support adds to its editor, for the raw view here. Monaco is that editor, but these
// come from VS Code's Markdown extension, so they are supplied: headings as the file's outline (⇧⌘O) and as
// sections that fold, ⌘-click on a link, and a web address pasted over selected words making them a link.
import { api, dirname } from './api';
import { openLink } from './links';
import { monaco } from './monaco';

interface Heading { line: number; level: number; text: string }
const FENCE = /^\s*(`{3,}|~{3,})/;
/** The file's headings and fenced blocks. A # inside a fenced block or the front matter is not a heading. */
function outline(model: monaco.editor.ITextModel) {
  const headings: Heading[] = [];
  const fences: [number, number][] = [];
  const last = model.getLineCount();
  let fence: { mark: string; line: number } | null = null;
  let n = 1;
  if (model.getLineContent(1).trim() === '---') {
    for (n = 2; n <= last && model.getLineContent(n).trim() !== '---'; n++);
    n += 1;
  }
  for (; n <= last; n++) {
    const line = model.getLineContent(n);
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = { mark: f[1][0], line: n };
      else if (f[1][0] === fence.mark) { fences.push([fence.line, n]); fence = null; }
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (m) headings.push({ line: n, level: m[1].length, text: m[2] });
  }
  return { headings, fences, last };
}
/** Where the section a heading opens ends: the line before the next heading of its level or above. */
function sectionEnd(headings: Heading[], i: number, last: number) {
  for (let j = i + 1; j < headings.length; j++) if (headings[j].level <= headings[i].level) return headings[j].line - 1;
  return last;
}

monaco.languages.registerDocumentSymbolProvider('markdown', {
  provideDocumentSymbols(model) {
    const { headings, last } = outline(model);
    const roots: monaco.languages.DocumentSymbol[] = [];
    const open: { level: number; symbol: monaco.languages.DocumentSymbol }[] = [];
    headings.forEach((h, i) => {
      const end = sectionEnd(headings, i, last);
      const symbol: monaco.languages.DocumentSymbol = {
        name: `${'#'.repeat(h.level)} ${h.text || '(no title)'}`, detail: '', kind: monaco.languages.SymbolKind.String, tags: [],
        range: new monaco.Range(h.line, 1, end, model.getLineMaxColumn(end)),
        selectionRange: new monaco.Range(h.line, 1, h.line, model.getLineMaxColumn(h.line)),
        children: [],
      };
      while (open.length && open[open.length - 1].level >= h.level) open.pop();
      (open.length ? open[open.length - 1].symbol.children! : roots).push(symbol);
      open.push({ level: h.level, symbol });
    });
    return roots;
  },
});

monaco.languages.registerFoldingRangeProvider('markdown', {
  provideFoldingRanges(model) {
    const { headings, fences, last } = outline(model);
    const ranges: monaco.languages.FoldingRange[] = fences.filter(([a, b]) => b > a).map(([start, end]) => ({ start, end }));
    headings.forEach((h, i) => {
      // The blank lines before the next heading stay on show, so the folded section keeps its space.
      let end = sectionEnd(headings, i, last);
      while (end > h.line && !model.getLineContent(end).trim()) end -= 1;
      if (end > h.line) ranges.push({ start: h.line, end });
    });
    return ranges;
  },
});

// A link to a file is carried to the opener below in an address of its own, with the folder it starts from.
const OPEN = 'astrolabe-open';
monaco.languages.registerLinkProvider('markdown', {
  provideLinks(model) {
    const links: monaco.languages.ILink[] = [];
    const dir = dirname(model.uri.path);
    const LINK = /\]\(\s*(<[^>\n]+>|[^)\s]+)/g;
    for (let n = 1; n <= model.getLineCount(); n++) {
      const line = model.getLineContent(n);
      if (!line.includes('](')) continue;
      for (const m of line.matchAll(LINK)) {
        const href = m[1].replace(/^<|>$/g, '');
        if (/^(https?|mailto):/i.test(href) || href.startsWith('#')) continue; // web addresses are found by the editor itself
        const start = m.index! + m[0].length - m[1].length + 1;
        links.push({ range: new monaco.Range(n, start, n, start + m[1].length), url: monaco.Uri.from({ scheme: OPEN, path: '/', query: JSON.stringify({ href, dir }) }), tooltip: 'Open file' });
      }
    }
    return { links };
  },
});
monaco.editor.registerLinkOpener({
  open(resource) {
    if (resource.scheme === OPEN) {
      try { const { href, dir } = JSON.parse(resource.query); void openLink(href, dir); } catch { /* not one of ours after all */ }
      return true;
    }
    if (/^(https?|mailto)$/.test(resource.scheme)) { api.app.openExternal(resource.toString(true)); return true; }
    return false;
  },
});

/** A web address pasted over selected words makes them a link to it, as VS Code does. Returns true when it did. */
export function pasteLink(editor: monaco.editor.IStandaloneCodeEditor, e: ClipboardEvent) {
  const model = editor.getModel();
  const sels = editor.getSelections() ?? [];
  const url = (e.clipboardData?.getData('text/plain') ?? '').trim();
  if (!model || model.getLanguageId() !== 'markdown' || sels.length !== 1 || sels[0].isEmpty() || sels[0].startLineNumber !== sels[0].endLineNumber) return false;
  if (!/^https?:\/\/\S+$/.test(url)) return false;
  const words = model.getValueInRange(sels[0]);
  // One address pasted over another replaces it, and words that are already a link are left to an ordinary paste.
  if (/^\S+:\/\/\S+$/.test(words.trim()) || /[[\]]/.test(words)) return false;
  e.preventDefault(); e.stopPropagation();
  editor.pushUndoStop();
  editor.executeEdits('paste-link', [{ range: sels[0], text: `[${words}](${url})`, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  return true;
}
