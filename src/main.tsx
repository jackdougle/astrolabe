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
import '@fontsource/ibm-plex-mono/500-italic.css'; // the note title
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'; // a built-in choice for notes
import '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { api, loadAppInfo } from './lib/api';
import { carried, loadHandoff, markLive, resumed } from './lib/handoff';
import { applyHeadingFont, applyNotesFont, loadGoogleFont } from './lib/fonts';
import { useStore } from './lib/store';
import { watchPops } from './lib/popfade';
import './lib/untitled'; // empty untitled notes are cleared away once you are off them

// xterm's GPU renderer builds its font string with a leading space, which this
// Chromium rejects, leaving glyphs at the canvas default of 10px. Trim it.
const fontProp = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font')!;
Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
  ...fontProp,
  set(value: string) { fontProp.set!.call(this, typeof value === 'string' ? value.trim() : value); },
});

async function boot() {
  await Promise.all([loadAppInfo(), loadHandoff()]);
  // The terminal measures its cell size from the font, so the font has to be ready first.
  await Promise.all([
    document.fonts.load('400 13px "Commit Mono"'),
    document.fonts.load('500 13px "Commit Mono"'),
    document.fonts.load('600 13px "Commit Mono"'),
    document.fonts.load('700 13px "Commit Mono"'),
    document.fonts.load('400 13px "Symbols Nerd Font Mono"', '\ue0b0'),
  ]).catch(() => {});
  await useStore.getState().init();
  let previousFile: string | null | undefined;
  const publishFile = (state: ReturnType<typeof useStore.getState>) => {
    const editor = state.panes[state.editors.active];
    const file = editor?.kind === 'editor' ? editor.active : null;
    if (file !== previousFile) {
      api.setActiveFile(file);
      previousFile = file;
    }
  };
  publishFile(useStore.getState());
  useStore.subscribe(publishFile);
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
  watchPops();
  // Tell the main process once the first screen is really there. After a reload in place it has been showing
  // a picture of the old page, which goes now; the wait is capped so a slow file never leaves the picture up.
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const settled = (async () => {
    await frame();
    const [{ allSessions }, { filesLoaded }] = await Promise.all([import('./lib/termSession'), import('./lib/monaco')]);
    await Promise.all([...allSessions().map((s) => s.ready), filesLoaded()]);
    await frame(); await frame();
  })();
  await Promise.race([settled, new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  markLive();
  api.app.booted?.();
  import('./lib/outside').then((m) => m.watchOutsideFiles());
  // Glyphs drawn while the page was hidden under that picture come out a shade heavier; draw them again now it is not.
  if (resumed()) import('./lib/termSession').then((m) => m.allSessions().forEach((t) => t.term.clearTextureAtlas()));
  // A reload that went well says nothing: the window standing there up to date is the news. Main still sends
  // 'Updated' for it; only a note about something going wrong (the last build put back) is shown.
  const note = carried<string>('note');
  if (note && note !== 'Updated') useStore.getState().showToast(note);
}
// A build that cannot start says so, and a window that was reloading goes back to the build before it.
boot().catch((err) => { api.app.bootFailed?.(); throw err; });
