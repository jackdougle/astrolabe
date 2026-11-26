// Night sky and engraved brass, after the instrument. Each palette is named for something you would sight with one.
export interface Theme {
  id: string; name: string; dark: boolean;
  bg: string; bgDeep: string; surface: string; surfaceHi: string; line: string;
  text: string; dim: string; faint: string;
  accent: string; ok: string; err: string; info: string; violet: string; cyan: string;
  selection: string;
  emphasis?: { bold: string; italic: string; link: string; underline: string };
  /** Terminal yellow, and numbers in code. Left out, it is the accent on a dark theme and a dark ochre on a light one. */
  yellow?: string;
  /** Colours in code where a theme's own differ from the slots above (GitHub's keywords are red, its strings blue). */
  code?: { keyword?: string; string?: string; number?: string; type?: string; variable?: string };
  /** The theme of the other kind that ⌘0 goes to from this one (Tokyo Night's is Tokyo Night Day). */
  twin?: string;
}

export const THEMES: Theme[] = [
  // The default: near-black with blue in it, and blue for emphasis. No purple.
  { id: 'meridian', name: 'Meridian', dark: true,
    bg: '#090D15', bgDeep: '#05080E', surface: '#101827', surfaceHi: '#192538', line: '#1C2A41',
    text: '#DCE6F3', dim: '#8B9AB1', faint: '#55647C',
    accent: '#4DA6FF', ok: '#78D39A', err: '#F2626E', info: '#6FB8FF', violet: '#8FB4FF', cyan: '#5AD3E8',
    selection: '#1C3A63' },
  { id: 'antares', name: 'Antares', dark: true,
    bg: '#1D1417', bgDeep: '#160E11', surface: '#291C20', surfaceHi: '#37262C', line: '#3F2B33',
    text: '#E7DAD0', dim: '#A99690', faint: '#705C5B',
    accent: '#EE7F92', ok: '#A6BF7A', err: '#F2594B', info: '#86A9D9', violet: '#C39BD8', cyan: '#79C2B4',
    selection: '#56303C' },
  { id: 'aurora', name: 'Aurora', dark: true,
    bg: '#131A18', bgDeep: '#0D1312', surface: '#1A2421', surfaceHi: '#24312D', line: '#2A3A35',
    text: '#D5DDD2', dim: '#8B9A92', faint: '#586861',
    accent: '#C5D07A', ok: '#8CC58A', err: '#E06C62', info: '#78AFCF', violet: '#B49AD6', cyan: '#6FC7B5',
    selection: '#2F4A40' },
  { id: 'vellum', name: 'Vellum', dark: false,
    bg: '#F7F7F3', bgDeep: '#ECECE6', surface: '#FFFFFF', surfaceHi: '#E2E3DC', line: '#D3D4CC',
    text: '#22273A', dim: '#5D6278', faint: '#9A9DAD',
    accent: '#2F4BB8', ok: '#3A7A36', err: '#C23B36', info: '#2F4BB8', violet: '#3E5FCB', cyan: '#1C7C77',
    selection: '#C9D3F5' },

  // Tokyo Night: cool indigo nights with purple and blue in them. Its light twin is Day.
  { id: 'tokyo-night', name: 'Tokyo Night', dark: true, twin: 'tokyo-day',
    bg: '#1A1B26', bgDeep: '#16161E', surface: '#1F2335', surfaceHi: '#292E42', line: '#292E42',
    text: '#C0CAF5', dim: '#9AA5CE', faint: '#565F89',
    accent: '#BB9AF7', ok: '#9ECE6A', err: '#F7768E', info: '#7AA2F7', violet: '#BB9AF7', cyan: '#7DCFFF',
    selection: '#33467C', yellow: '#E0AF68', code: { number: '#FF9E64', type: '#2AC3DE', variable: '#C0CAF5' } },
  { id: 'tokyo-day', name: 'Tokyo Night Day', dark: false, twin: 'tokyo-night',
    bg: '#E1E2E7', bgDeep: '#D5D6DE', surface: '#ECEDF1', surfaceHi: '#C8CBD9', line: '#C4C8DA',
    text: '#343B58', dim: '#5A6390', faint: '#8990B3',
    accent: '#7847BD', ok: '#485E30', err: '#B4343D', info: '#2E5AB8', violet: '#7847BD', cyan: '#166775',
    selection: '#B7C1E3', yellow: '#8F5E15', code: { number: '#965027', type: '#0F4B6E', variable: '#343B58' } },

  // Pure black and pure white: no tint at all, blue for emphasis.
  { id: 'pure-black', name: 'Pure', dark: true, twin: 'pure-white',
    bg: '#000000', bgDeep: '#000000', surface: '#0E0E0E', surfaceHi: '#1A1A1A', line: '#202020',
    text: '#E8E8E8', dim: '#9B9B9B', faint: '#5C5C5C',
    accent: '#4DA6FF', ok: '#6FD08C', err: '#F25F66', info: '#6FB8FF', violet: '#9DB7FF', cyan: '#5AD3E8',
    selection: '#233A5C', yellow: '#E5C07B' },
  { id: 'pure-white', name: 'Pure White', dark: false, twin: 'pure-black',
    bg: '#FFFFFF', bgDeep: '#F5F5F5', surface: '#FFFFFF', surfaceHi: '#EBEBEB', line: '#E0E0E0',
    text: '#141414', dim: '#555555', faint: '#999999',
    accent: '#0A64D8', ok: '#1E7B34', err: '#C8252C', info: '#0A64D8', violet: '#3E5FCB', cyan: '#0F7A80',
    selection: '#CCE0FF' },

  // Electric keeps the surfaces neutral and puts the color in the typography.
  { id: 'electric-blue-dark', name: 'Electric', dark: true, twin: 'electric-blue-light',
    bg: '#000000', bgDeep: '#000000', surface: '#101010', surfaceHi: '#202020', line: '#4A4A4A',
    text: '#FAFAFA', dim: '#C6C6C6', faint: '#999999',
    accent: '#64B8FF', ok: '#7ADF9F', err: '#FF8A9A', info: '#83C4FF', violet: '#C5A7F7', cyan: '#86DAE7',
    selection: '#143555', yellow: '#F3D078',
    emphasis: { bold: '#43EDFF', italic: '#C7FF58', link: '#FF81E5', underline: '#F4FF35' } },
  { id: 'electric-blue-light', name: 'Electric', dark: false, twin: 'electric-blue-dark',
    bg: '#FFFFFF', bgDeep: '#FFFFFF', surface: '#F7F7F7', surfaceHi: '#EAEAEA', line: '#929292',
    text: '#101010', dim: '#363636', faint: '#585858',
    accent: '#0059B7', ok: '#146637', err: '#AC1E36', info: '#0755A9', violet: '#6442A0', cyan: '#006773',
    selection: '#C1DBFA', yellow: '#775000',
    emphasis: { bold: '#004CCE', italic: '#365D00', link: '#A50084', underline: '#695500' } },

  // GitHub, after its Primer colours, with its own code colours (red keywords, blue strings).
  { id: 'github-dark', name: 'GitHub Dark', dark: true, twin: 'github-light',
    bg: '#0D1117', bgDeep: '#010409', surface: '#161B22', surfaceHi: '#21262D', line: '#30363D',
    text: '#E6EDF3', dim: '#8D96A0', faint: '#6E7681',
    accent: '#4493F8', ok: '#3FB950', err: '#F85149', info: '#58A6FF', violet: '#BC8CFF', cyan: '#39C5CF',
    selection: '#1F3B63', yellow: '#D29922',
    code: { keyword: '#FF7B72', string: '#A5D6FF', number: '#79C0FF', type: '#FFA657', variable: '#FFA657' } },
  { id: 'github-light', name: 'GitHub Light', dark: false, twin: 'github-dark',
    bg: '#FFFFFF', bgDeep: '#F6F8FA', surface: '#FFFFFF', surfaceHi: '#EAEEF2', line: '#D0D7DE',
    text: '#1F2328', dim: '#656D76', faint: '#8C959F',
    accent: '#0969DA', ok: '#1A7F37', err: '#CF222E', info: '#0969DA', violet: '#8250DF', cyan: '#1B7C83',
    selection: '#B6E3FF', yellow: '#9A6700',
    code: { keyword: '#CF222E', string: '#0A3069', number: '#0550AE', type: '#953800', variable: '#953800' } },
  { id: 'github-dark-hc', name: 'GitHub Dark High Contrast', dark: true, twin: 'github-light-hc',
    bg: '#050608', bgDeep: '#000102', surface: '#0D1117', surfaceHi: '#1E2229', line: '#7A828E',
    text: '#F0F3F6', dim: '#BDC4CC', faint: '#9EA7B3',
    accent: '#71B7FF', ok: '#26CD4D', err: '#FF6A69', info: '#71B7FF', violet: '#CB9EFF', cyan: '#56D4DD',
    selection: '#1E4273', yellow: '#F0B72F',
    code: { keyword: '#FF9492', string: '#ADDCFF', number: '#91CBFF', type: '#FFB757', variable: '#FFB757' } },
  { id: 'github-light-hc', name: 'GitHub Light High Contrast', dark: false, twin: 'github-dark-hc',
    bg: '#FFFFFF', bgDeep: '#F0F3F6', surface: '#FFFFFF', surfaceHi: '#E7ECF0', line: '#88929D',
    text: '#0E1116', dim: '#323941', faint: '#4B535D',
    accent: '#0349B4', ok: '#055D20', err: '#A0111F', info: '#0349B4', violet: '#622CBC', cyan: '#1B6A7A',
    selection: '#9CD7FF', yellow: '#744500',
    code: { keyword: '#A0111F', string: '#032563', number: '#023B95', type: '#702C00', variable: '#702C00' } },
];

/** Terminal yellow and the colour of numbers, for themes that do not name one. */
export const yellowOf = (t: Theme) => t.yellow ?? (t.dark ? t.accent : '#9A6B00');

/** The colour ⌘F marks its matches in: amber on every theme, so a match is never mistaken for a selection. */
export const findColor = (t: Theme) => (t.dark ? '#E8A33D' : '#E2A316');

export function getTheme(id: string) { return THEMES.find((t) => t.id === id) ?? THEMES[0]; }

export function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function applyTheme(t: Theme, accentColor?: string) {
  const r = document.documentElement.style;
  const vars: Record<string, string> = {
    bg: t.bg, 'bg-deep': t.bgDeep, surface: t.surface, 'surface-hi': t.surfaceHi, line: t.line,
    text: t.text, dim: t.dim, faint: t.faint, accent: /^#[0-9a-f]{6}$/i.test(accentColor ?? '') ? accentColor! : t.accent, ok: t.ok, err: t.err, info: t.info,
    violet: t.violet, cyan: t.cyan, selection: t.selection,
    'bold-color': t.emphasis?.bold ?? 'inherit', 'italic-color': t.emphasis?.italic ?? 'inherit',
    'link-color': t.emphasis?.link ?? t.info, 'underline-color': t.emphasis?.underline ?? '',
  };
  for (const [k, v] of Object.entries(vars)) r.setProperty(`--${k}`, v);
  r.setProperty('--find', findColor(t));
  r.setProperty('--neon', t.dark ? '#3FD8FF' : '#0A7BFF');
  document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
}

export function xtermTheme(t: Theme) {
  const up = (c: string) => mix(c, t.dark ? '#FFFFFF' : '#000000', 0.22);
  return {
    // Transparent: the window's own translucent background shows through the terminal. On a light theme it is
    // the ground's own colour made transparent, so the terminal knows what its text has to stand out from (termContrast).
    background: t.dark ? '#00000000' : `${t.bg}00`, foreground: t.text, cursor: t.accent, cursorAccent: t.bg,
    selectionBackground: t.selection, selectionInactiveBackground: mix(t.selection, t.bg, 0.5),
    black: t.dark ? t.surfaceHi : t.text, red: t.err, green: t.ok, yellow: yellowOf(t),
    blue: t.info, magenta: t.violet, cyan: t.cyan, white: t.dark ? t.text : t.dim,
    brightBlack: t.faint, brightRed: up(t.err), brightGreen: up(t.ok), brightYellow: up(yellowOf(t)),
    brightBlue: up(t.info), brightMagenta: up(t.violet), brightCyan: up(t.cyan), brightWhite: t.dark ? '#FFFFFF' : t.text,
    scrollbarSliderBackground: t.line + '99', scrollbarSliderHoverBackground: t.faint + '99', scrollbarSliderActiveBackground: t.faint,
  };
}

/** How far a terminal's text must stand out from the ground. Programs and prompts pick their colours for a dark
 *  terminal (pale greens, yellows, light greys); on a light theme those are darkened until they can be read. */
export const termContrast = (t: Theme) => (t.dark ? 1 : 3.4);

export function monacoTheme(t: Theme) {
  const s = (c: string) => c.slice(1);
  const c = { keyword: t.violet, string: t.ok, number: yellowOf(t), type: t.cyan, variable: t.info, ...t.code };
  return {
    base: (t.dark ? 'vs-dark' : 'vs') as 'vs-dark' | 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: s(t.text) },
      { token: 'comment', foreground: s(t.faint), fontStyle: 'italic' },
      { token: 'keyword', foreground: s(c.keyword) },
      { token: 'string', foreground: s(c.string) },
      { token: 'number', foreground: s(c.number) },
      { token: 'type', foreground: s(c.type) },
      { token: 'tag', foreground: s(t.err) },
      { token: 'attribute.name', foreground: s(c.number) },
      { token: 'attribute.value', foreground: s(c.string) },
      { token: 'delimiter', foreground: s(t.dim) },
      { token: 'variable', foreground: s(c.variable) },
      { token: 'predefined', foreground: s(t.info) },
      { token: 'regexp', foreground: s(t.cyan) },
      { token: 'emphasis', fontStyle: 'italic', ...(t.emphasis && { foreground: s(t.emphasis.italic) }) },
      ...(t.emphasis ? [{ token: 'string.link.markdown', foreground: s(t.emphasis.link) }] : []),
      { token: 'strong', fontStyle: 'bold', ...(t.emphasis && { foreground: s(t.emphasis.bold) }) },
    ],
    colors: {
      'editor.background': '#00000000', 'editor.foreground': t.text,
      'editorCursor.foreground': t.accent,
      'editor.lineHighlightBackground': t.surface + '70', 'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': t.selection, 'editor.inactiveSelectionBackground': mix(t.selection, t.bg, 0.5),
      'editor.selectionHighlightBackground': t.selection + '66',
      'editor.findMatchBackground': t.accent + '55', 'editor.findMatchHighlightBackground': t.accent + '2A',
      'editorLineNumber.foreground': t.faint, 'editorLineNumber.activeForeground': t.dim,
      'editorIndentGuide.background1': t.line + '88', 'editorIndentGuide.activeBackground1': t.faint,
      'editorWhitespace.foreground': t.line,
      'editorWidget.background': t.surface, 'editorWidget.border': t.line, 'editorWidget.foreground': t.text,
      'editorSuggestWidget.background': t.surface, 'editorSuggestWidget.border': t.line,
      'editorSuggestWidget.foreground': t.text, 'editorSuggestWidget.selectedBackground': t.surfaceHi,
      'editorSuggestWidget.highlightForeground': t.accent, 'editorSuggestWidget.focusHighlightForeground': t.accent,
      'editorSuggestWidget.selectedForeground': t.text,
      'editorHoverWidget.background': t.surface, 'editorHoverWidget.border': t.line,
      'editorGhostText.foreground': t.faint,
      'editorBracketMatch.background': t.selection + '88', 'editorBracketMatch.border': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': t.line + '99', 'scrollbarSlider.hoverBackground': t.faint + '99', 'scrollbarSlider.activeBackground': t.faint,
      'input.background': t.bgDeep, 'input.border': t.line, 'input.foreground': t.text, 'focusBorder': t.accent + '99',
      'list.hoverBackground': t.surfaceHi, 'list.activeSelectionBackground': t.surfaceHi, 'list.highlightForeground': t.accent,
      'editorStickyScroll.background': t.bg, 'editorGutter.background': '#00000000',
      'editorError.foreground': t.err, 'editorWarning.foreground': yellowOf(t), 'editorInfo.foreground': t.info,
      'editorLink.activeForeground': t.emphasis?.link ?? t.info, 'minimap.background': t.bg,
    },
  };
}
