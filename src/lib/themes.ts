// Night sky and engraved brass, after the instrument. Each palette is named for something you would sight with one.
export interface Theme {
  id: string; name: string; dark: boolean;
  bg: string; bgDeep: string; surface: string; surfaceHi: string; line: string;
  text: string; dim: string; faint: string;
  accent: string; ok: string; err: string; info: string; violet: string; cyan: string;
  selection: string;
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
    accent: '#2F4BB8', ok: '#3A7A36', err: '#C23B36', info: '#2F4BB8', violet: '#7A4DB8', cyan: '#1C7C77',
    selection: '#C9D3F5' },
];

export function getTheme(id: string) { return THEMES.find((t) => t.id === id) ?? THEMES[0]; }

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function applyTheme(t: Theme) {
  const r = document.documentElement.style;
  const vars: Record<string, string> = {
    bg: t.bg, 'bg-deep': t.bgDeep, surface: t.surface, 'surface-hi': t.surfaceHi, line: t.line,
    text: t.text, dim: t.dim, faint: t.faint, accent: t.accent, ok: t.ok, err: t.err, info: t.info,
    violet: t.violet, cyan: t.cyan, selection: t.selection,
  };
  for (const [k, v] of Object.entries(vars)) r.setProperty(`--${k}`, v);
  r.setProperty('--neon', t.dark ? '#3FD8FF' : '#0A7BFF');
  document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
}

export function xtermTheme(t: Theme) {
  const up = (c: string) => mix(c, t.dark ? '#FFFFFF' : '#000000', 0.22);
  return {
    // Transparent: the window's own translucent background shows through the terminal.
    background: '#00000000', foreground: t.text, cursor: t.accent, cursorAccent: t.bg,
    selectionBackground: t.selection, selectionInactiveBackground: mix(t.selection, t.bg, 0.5),
    black: t.dark ? t.surfaceHi : t.text, red: t.err, green: t.ok, yellow: t.dark ? t.accent : '#9A6B00',
    blue: t.info, magenta: t.violet, cyan: t.cyan, white: t.dark ? t.text : t.dim,
    brightBlack: t.faint, brightRed: up(t.err), brightGreen: up(t.ok), brightYellow: up(t.dark ? t.accent : '#9A6B00'),
    brightBlue: up(t.info), brightMagenta: up(t.violet), brightCyan: up(t.cyan), brightWhite: t.dark ? '#FFFFFF' : t.text,
    scrollbarSliderBackground: t.line + '99', scrollbarSliderHoverBackground: t.faint + '99', scrollbarSliderActiveBackground: t.faint,
  };
}

export function monacoTheme(t: Theme) {
  const s = (c: string) => c.slice(1);
  return {
    base: (t.dark ? 'vs-dark' : 'vs') as 'vs-dark' | 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: s(t.text) },
      { token: 'comment', foreground: s(t.faint), fontStyle: 'italic' },
      { token: 'keyword', foreground: s(t.violet) },
      { token: 'string', foreground: s(t.ok) },
      { token: 'number', foreground: s(t.dark ? t.accent : '#9A6B00') },
      { token: 'type', foreground: s(t.cyan) },
      { token: 'tag', foreground: s(t.err) },
      { token: 'attribute.name', foreground: s(t.dark ? t.accent : '#9A6B00') },
      { token: 'attribute.value', foreground: s(t.ok) },
      { token: 'delimiter', foreground: s(t.dim) },
      { token: 'variable', foreground: s(t.info) },
      { token: 'predefined', foreground: s(t.info) },
      { token: 'regexp', foreground: s(t.cyan) },
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'strong', fontStyle: 'bold' },
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
      'editorError.foreground': t.err, 'editorWarning.foreground': t.dark ? t.accent : '#9A6B00', 'editorInfo.foreground': t.info,
      'editorLink.activeForeground': t.info, 'minimap.background': t.bg,
    },
  };
}
