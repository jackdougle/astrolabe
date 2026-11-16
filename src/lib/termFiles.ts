// Finding the files a terminal's text mentions, so that ⌘-click opens them in the editor.
//
// A path that resolves from the terminal's folder, or an absolute one, is found by termSession.ts with a plain look
// on disk. This covers what that misses, which is most of what an agent writes: a file named from some other folder
// ("src/lib/store.ts" said from the top of a workspace that holds the project further down), a bare file name
// ("SKILL.md"), a name with spaces in it ("unova/lumiose/next steps.md"), and a name with a full stop or a bracket
// straight after it. It works from the list of the project's files: a mention is the longest run of text that ends
// a file's path, back to the start of one of its folders. When several files end that way, the one changed most
// recently wins, since that is the one being talked about.
import { api, appInfo, joinPath } from './api';

export interface Mention { at: number; len: number; path: string; line?: number; col?: number }

interface Index {
  /** Absolute paths, most recently changed first. */
  paths: string[];
  /** The last word of each file's name (what follows its last space or slash) → where those files are in `paths`. */
  byEnd: Map<string, number[]>;
}

const lastWord = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf(' ')) + 1);

export function buildIndex(root: string, rels: string[]): Index {
  const paths = rels.map((rel) => joinPath(root, rel));
  const byEnd = new Map<string, number[]>();
  paths.forEach((path, i) => {
    const key = lastWord(path);
    const list = byEnd.get(key);
    if (list) list.push(i); else byEnd.set(key, [i]);
  });
  return { paths, byEnd };
}

/** ":12", ":12:3", ":12-20", "#L12", "#L12C3", "#L12-L20" straight after a file's name. */
const PLACE = /^(?::(\d+)(?::(\d+)|-\d+)?|#L(\d+)(?:C(\d+))?(?:-L?\d+)?)/;
/** The end of a file name: a full stop and an extension, with nothing of a word after it. */
const ENDING = /\.[A-Za-z]\w{0,7}(?![\w])/g;
/** Characters a path is made of. One of these straight before a match means the text names something else. */
const PATHY = /[\w/.~@+%-]/;

/** How many characters `text`, read backwards from `end`, shares with the end of `path`. */
function shared(text: string, end: number, path: string) {
  let n = 0;
  while (n < path.length && n < end && text[end - 1 - n] === path[path.length - 1 - n]) n += 1;
  return n;
}

export function findMentions(text: string, index: Index, home = ''): Mention[] {
  const out: Mention[] = [];
  let m: RegExpExecArray | null;
  ENDING.lastIndex = 0;
  while ((m = ENDING.exec(text)) && out.length < 12) {
    const end = m.index + m[0].length;
    // The word the name ends with, as written: back to a space or a slash, less any bracket or quote it opens with.
    let start = end;
    while (start > 0 && !/[\s/]/.test(text[start - 1])) start -= 1;
    let word = text.slice(start, end);
    let list = index.byEnd.get(word);
    if (!list) { word = word.replace(/^[^\p{L}\p{N}_.]+/u, ''); list = word ? index.byEnd.get(word) : undefined; }
    if (!list) continue;
    let best: { len: number; path: string } | null = null;
    for (const i of list) {
      const path = index.paths[i];
      // Written from the home folder (~/…), a path matches as far as its tilde.
      const forms = home && path.startsWith(`${home}/`) ? [path, `~${path.slice(home.length)}`] : [path];
      for (const form of forms) {
        let len = shared(text, end, form);
        // Back to the start of a folder or of the file's name: a match cannot begin part-way through one.
        while (len > 0 && len < form.length && form[form.length - len - 1] !== '/') len -= 1;
        const name = form.length - form.lastIndexOf('/') - 1;
        if (len < name) continue;
        const before = text[end - len - 1];
        const whole = len === form.length;
        // "./src/a.ts" is "src/a.ts"; anything else of a path in front means a different file is meant.
        if (!whole && before && PATHY.test(before) && !/(^|[^\w/.~@+%-])\.\/$/.test(text.slice(0, end - len))) continue;
        if (!best || len > best.len) best = { len, path }; // an equal match keeps the earlier, more recently changed, file
      }
    }
    if (!best) continue;
    const place = PLACE.exec(text.slice(end));
    const line = place ? Number(place[1] ?? place[3]) : undefined;
    const col = place && (place[2] ?? place[4]) ? Number(place[2] ?? place[4]) : undefined;
    out.push({ at: end - best.len, len: best.len + (place ? place[0].length : 0), path: best.path, ...(line ? { line } : null), ...(col ? { col } : null) });
  }
  return out;
}

/** An absolute path with spaces in it ("~/Library/Application Support/x.json"): every stretch from a path's start to
 *  the end of a file name further along the line, longest first, for the caller to look for on disk. */
export function spacedPaths(text: string): { at: number; raw: string }[] {
  const out: { at: number; raw: string }[] = [];
  const starts = /(?<![\w.~/])~?\/[\w.@+%-]/g;
  let s: RegExpExecArray | null;
  while ((s = starts.exec(text)) && out.length < 8) {
    const found: { at: number; raw: string }[] = [];
    ENDING.lastIndex = s.index;
    let e: RegExpExecArray | null;
    while ((e = ENDING.exec(text)) && found.length < 4) {
      const raw = text.slice(s.index, e.index + e[0].length);
      if (raw.length > 300 || /["'`<>|*?\n]/.test(raw)) break;
      if (raw.includes(' ')) found.push({ at: s.index, raw });
    }
    out.push(...found.reverse());
  }
  return out;
}

// The list of a project's files, kept for a short while: hovering along a screen of output asks for it row after row.
const KEEP_MS = 15000;
const lists = new Map<string, { at: number; index: Index; loading: Promise<Index> | null }>();

/** The files under `root`. A list that has gone stale is still used while a new one is fetched. */
export async function projectIndex(root: string): Promise<Index | null> {
  // The home folder and the disk's top are not projects: listing them would take seconds and find little.
  if (!root || root === '/' || root === appInfo.home) return null;
  const now = Date.now();
  const had = lists.get(root);
  if (had && now - had.at < KEEP_MS) return had.index;
  const load = () => (api.fs.listFiles(root) as Promise<string[]>).then((rels) => {
    const index = buildIndex(root, Array.isArray(rels) ? rels : []);
    lists.set(root, { at: Date.now(), index, loading: null });
    return index;
  });
  if (had) { if (!had.loading) had.loading = load().catch(() => { had.loading = null; return had.index; }); return had.index; }
  try { return await load(); } catch { return null; }
}
