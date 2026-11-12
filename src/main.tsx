import { createRoot } from 'react-dom/client';
import '@fontsource/commit-mono/400.css';
import '@fontsource/commit-mono/500.css';
import '@fontsource/commit-mono/600.css';
import '@fontsource/commit-mono/500-italic.css';
import '@fontsource/commit-mono/700-italic.css';
import '@fontsource/commit-mono/700.css';
import '@fontsource/commit-mono/400-italic.css';
import '@fontsource/cutive-mono/400.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { loadAppInfo } from './lib/api';
import { applyHeadingFont, applyNotesFont, loadGoogleFont } from './lib/fonts';
import { useStore } from './lib/store';

// xterm's GPU renderer builds its font string with a leading space, which this
// Chromium rejects, leaving glyphs at the canvas default of 10px. Trim it.
const fontProp = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font')!;
Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
  ...fontProp,
  set(value: string) { fontProp.set!.call(this, typeof value === 'string' ? value.trim() : value); },
});

async function boot() {
  await loadAppInfo();
  // The terminal measures its cell size from the font, so the font has to be ready first.
  await Promise.all([
    document.fonts.load('400 13px "Commit Mono"'),
    document.fonts.load('500 13px "Commit Mono"'),
    document.fonts.load('600 13px "Commit Mono"'),
    document.fonts.load('700 13px "Commit Mono"'),
    document.fonts.load('400 13px "Symbols Nerd Font Mono"', '\ue0b0'),
  ]).catch(() => {});
  await useStore.getState().init();
  // Saved Google Fonts: wait briefly so the first paint uses them, but never hold the app up offline.
  const { fontFamily, notesFont, headingFont } = useStore.getState().settings;
  const wanted = [fontFamily, notesFont, headingFont].filter(Boolean).map((f) => loadGoogleFont(f));
  if (wanted.length) await Promise.race([Promise.all(wanted), new Promise((r) => setTimeout(r, 1500))]);
  applyNotesFont(notesFont);
  applyHeadingFont(headingFont);
  // If the terminal font arrives after the first paint, have every terminal measure it again.
  if (fontFamily) loadGoogleFont(fontFamily).then(() => import('./lib/termSession').then((m) => m.allSessions().forEach((s) => s.applyAppearance())));
  const { App } = await import('./components/App');
  createRoot(document.getElementById('root')!).render(<App />);
}
boot();
