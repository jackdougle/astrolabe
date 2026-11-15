// Which icon a file tab shows, by the file's extension. Code files get a mark for their language (the keys are
// drawn in Icons.tsx as outline glyphs, so the tab's existing colour and dirty-pulse apply to them); Markdown,
// plain text and anything without a telling extension keep the plain page icon, as notes always had.

const BY_EXT: Record<string, string> = {
  py: 'langPy', pyi: 'langPy', pyw: 'langPy',
  js: 'langJs', jsx: 'langJs', mjs: 'langJs', cjs: 'langJs',
  ts: 'langTs', tsx: 'langTs', mts: 'langTs', cts: 'langTs',
  rs: 'langRust',
  jl: 'langJulia',
  json: 'langJson', jsonc: 'langJson', json5: 'langJson',
  html: 'langHtml', htm: 'langHtml', xml: 'langHtml', svg: 'langHtml', vue: 'langHtml', astro: 'langHtml',
  css: 'langCss', scss: 'langCss', sass: 'langCss', less: 'langCss',
  sh: 'langShell', bash: 'langShell', zsh: 'langShell', fish: 'langShell',
};

// Kept on the plain page icon: notes and anything that reads as prose, not code.
const PLAIN = new Set(['', 'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'log']);

/** The `Icon` name for a file tab: a language glyph for code, `code` for other code, `file` for notes/text. */
export function fileIconName(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (PLAIN.has(ext)) return 'file';
  return BY_EXT[ext] ?? 'code';
}
