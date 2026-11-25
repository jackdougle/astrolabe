import { api } from './api';

export interface FontInfo { family: string; category: string }
let catalogue: Promise<FontInfo[]> | null = null;
export function googleFonts() { return (catalogue ??= api.fonts.list()); }

/** Families that ship with the app, by the name the catalogue knows them under, and the bundled face each one is drawn in.
 *  These work offline and are never fetched. */
export const BUNDLED: Record<string, string> = { 'Atkinson Hyperlegible Next': 'Atkinson Hyperlegible Next Variable' };
/** The CSS family a chosen font is drawn in. */
export const faceOf = (family: string) => BUNDLED[family] ?? family;

const loaded = new Map<string, Promise<boolean>>();
/** Fetches a Google Fonts family (regular, bold and their italics where the family has them). A bundled family only has its file read. */
export function loadGoogleFont(family: string): Promise<boolean> {
  let p = loaded.get(family);
  if (!p && BUNDLED[family]) {
    const face = BUNDLED[family];
    p = Promise.all([document.fonts.load(`500 14px "${face}"`), document.fonts.load(`italic 500 14px "${face}"`)]).then(() => document.fonts.check(`500 14px "${face}"`), () => false);
    loaded.set(family, p);
  }
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, '+')}:400,400i,500,500i,600,600i,700,700i&display=swap`;
      link.onload = () => {
        Promise.all([document.fonts.load(`400 14px "${family}"`), document.fonts.load(`500 14px "${family}"`), document.fonts.load(`700 14px "${family}"`)])
          .then(() => resolve(document.fonts.check(`400 14px "${family}"`)), () => resolve(false));
      };
      link.onerror = () => { loaded.delete(family); resolve(false); };
      document.head.appendChild(link);
    });
    loaded.set(family, p);
  }
  return p;
}

export const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
/** Text of rendered notes: SF Pro unless a family was chosen. */
export function applyNotesFont(family: string) {
  document.documentElement.style.setProperty('--notes', family ? `"${faceOf(family)}", ${SYSTEM}` : SYSTEM);
}
/** Headings of rendered notes: Literata unless a family was chosen. */
export function applyHeadingFont(family: string) {
  document.documentElement.style.setProperty('--notes-heading', family ? `"${faceOf(family)}", "Literata Variable", Georgia, serif` : '"Literata Variable", Georgia, serif');
}
