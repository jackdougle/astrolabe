import { api } from './api';

export interface FontInfo { family: string; category: string }
let catalogue: Promise<FontInfo[]> | null = null;
export function googleFonts() { return (catalogue ??= api.fonts.list()); }

const loaded = new Map<string, Promise<boolean>>();
/** Fetches a Google Fonts family (regular, bold and their italics where the family has them). */
export function loadGoogleFont(family: string): Promise<boolean> {
  let p = loaded.get(family);
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
  document.documentElement.style.setProperty('--notes', family ? `"${family}", ${SYSTEM}` : SYSTEM);
}
/** Headings of rendered notes: Literata unless a family was chosen. */
export function applyHeadingFont(family: string) {
  document.documentElement.style.setProperty('--notes-heading', family ? `"${family}", "Literata Variable", Georgia, serif` : '"Literata Variable", Georgia, serif');
}
