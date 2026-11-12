import type { AstrolabeApi } from '../../electron/preload';

declare global {
  interface Window { astrolabe: AstrolabeApi }
}
export const api = window.astrolabe;

export interface AppInfo { home: string; shell: string; platform: string; settingsFile: string; version: string }
export let appInfo: AppInfo = { home: '/', shell: '/bin/zsh', platform: 'darwin', settingsFile: '', version: '' };
export async function loadAppInfo() { appInfo = await api.app.info(); return appInfo; }

export function tildify(p: string) {
  const h = appInfo.home;
  if (p === h) return '~';
  return p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
}
export function basename(p: string) {
  if (p === '/') return '/';
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}
export function dirname(p: string) {
  const i = p.replace(/\/+$/, '').lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}
export function joinPath(a: string, b: string) {
  if (b.startsWith('/')) return b;
  if (b === '~' || b.startsWith('~/')) return appInfo.home + b.slice(1);
  const parts = (a + '/' + b).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}
export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
