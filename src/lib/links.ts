import { api, joinPath } from './api';
import { useStore } from './store';

export interface FileTarget { path: string; line?: number; col?: number }

/** "#L524", "#L524C3", "#L10-L20": the line anchors agents and GitHub put on file links. */
function anchor(hash: string): { line?: number; col?: number } {
  const m = /^#L(\d+)(?:C(\d+))?/i.exec(hash);
  return m ? { line: Number(m[1]), col: m[2] ? Number(m[2]) : undefined } : {};
}

/** Reads a link's target as a file on disk: file:// URLs, absolute, ~ and relative paths, with an optional
 *  ":line:col" or "#L12" suffix. Returns null for web links and other schemes. */
export function fileTarget(href: string, baseDir: string): FileTarget | null {
  const raw = href.trim();
  if (/^file:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return { path: decodeURIComponent(u.pathname), ...anchor(u.hash) };
    } catch { return null; }
  }
  if (/^[a-z][\w+.-]*:\/\//i.test(raw) || /^(mailto|tel|data|javascript):/i.test(raw)) return null; // web and app links, not "main.py:8"
  let rest = raw; let pos: { line?: number; col?: number } = {};
  const hash = rest.indexOf('#');
  if (hash >= 0) { pos = anchor(rest.slice(hash)); rest = rest.slice(0, hash); }
  const lc = /:(\d+)(?::(\d+))?$/.exec(rest);
  if (lc) { pos = { line: Number(lc[1]), col: lc[2] ? Number(lc[2]) : undefined }; rest = rest.slice(0, lc.index); }
  if (!rest) return null;
  try { rest = decodeURI(rest); } catch {}
  return { path: joinPath(baseDir, rest), ...pos };
}

/** What ⌘-click does on any link: files open in the editor (at the line, if given), folders show in
 *  Finder, web links open in the browser. */
export async function openLink(href: string, baseDir: string) {
  const store = useStore.getState();
  if (/^(https?|mailto):/i.test(href.trim())) { api.app.openExternal(href.trim()); return; }
  const t = fileTarget(href, baseDir);
  if (!t) return;
  const st = await api.fs.stat(t.path);
  if (!st.exists) { store.showToast(`No such file: ${t.path}`); return; }
  if (st.dir) { api.app.reveal(t.path); return; }
  store.openFile(t.path, t.line ? { line: t.line, col: t.col } : undefined);
}
