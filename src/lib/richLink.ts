// A plain click on a link in a rendered note brings up a small box under it: the address, which goes there
// when clicked, and a pencil that turns the address into a field to change it. (⌘-click still goes straight there.)
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Mark } from '@milkdown/kit/prose/model';
import { appInfo, dirname } from './api';
import { openLink } from './links';

const PENCIL = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.9 2.6l2.5 2.5L5.6 12.9l-3.2.7.7-3.2z"/><path d="M9.4 4.1l2.5 2.5"/></svg>';

let close: (() => void) | null = null;
export function closeLinkBox() { close?.(); }

/** The stretch of the note that carries the link drawn as `a`, and the link itself. */
function linkAt(view: EditorView, a: HTMLElement): { from: number; to: number; mark: Mark } | null {
  const type = view.state.schema.marks.link;
  if (!type) return null;
  let pos: number;
  try { pos = view.posAtDOM(a, 0); } catch { return null; }
  const $pos = view.state.doc.resolve(pos);
  const start = $pos.start();
  let found: { from: number; to: number; mark: Mark } | null = null;
  let run: { from: number; to: number; mark: Mark } | null = null;
  const end = () => { if (run && pos >= run.from && pos < run.to) found = run; run = null; };
  $pos.parent.forEach((child, offset) => {
    const mark = type.isInSet(child.marks);
    const at = start + offset;
    if (mark && run && mark.eq(run.mark)) { run.to = at + child.nodeSize; return; }
    end();
    if (mark) run = { from: at, to: at + child.nodeSize, mark };
  });
  end();
  return found;
}

export function showLinkBox(view: EditorView, a: HTMLAnchorElement, event: MouseEvent) {
  close?.();
  const href = a.getAttribute('href') ?? '';
  const file = (view.dom.closest('[data-file]') as HTMLElement | null)?.dataset.file;
  const box = document.createElement('div');
  box.className = 'link-box';
  box.innerHTML = `<button class="link-go" type="button"><span></span></button><button class="link-edit" type="button" title="Edit link">${PENCIL}</button>`;
  const go = box.querySelector('.link-go') as HTMLButtonElement;
  const edit = box.querySelector('.link-edit') as HTMLButtonElement;
  go.firstElementChild!.textContent = href || 'No address';
  go.title = href;
  document.body.appendChild(box);

  // Under the line of the link that was clicked, or above it when there is no room below.
  const place = () => {
    if (!a.isConnected) { shut(); return; }
    const rects = [...a.getClientRects()];
    const r = rects.find((x) => event.clientY >= x.top - 1 && event.clientY <= x.bottom + 1) ?? rects[0] ?? a.getBoundingClientRect();
    const w = box.offsetWidth; const h = box.offsetHeight;
    const below = r.bottom + 6;
    box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    box.style.top = `${Math.round(below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below)}px`;
  };
  const outside = (e: Event) => { if (!box.contains(e.target as Node)) shut(); };
  const onKey = (e: KeyboardEvent) => { if (!box.contains(e.target as Node) && !['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) shut(); };
  const shut = () => {
    if (close !== shut) return;
    close = null;
    window.removeEventListener('mousedown', outside, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    box.remove();
  };
  close = shut;
  window.addEventListener('mousedown', outside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  place();

  go.addEventListener('click', () => {
    shut();
    if (href) void openLink(href, file ? dirname(file) : appInfo.home);
  });
  edit.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'link-input';
    input.value = href;
    input.spellcheck = false;
    input.placeholder = 'Address, or empty to remove the link';
    box.classList.add('is-editing');
    box.replaceChildren(input);
    place();
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); view.focus(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      const next = input.value.trim();
      const at = linkAt(view, a);
      shut();
      if (at && next !== href) {
        const type = view.state.schema.marks.link;
        const tr = view.state.tr.removeMark(at.from, at.to, type);
        if (next) tr.addMark(at.from, at.to, type.create({ ...at.mark.attrs, href: next }));
        view.dispatch(tr);
      }
      view.focus();
    });
  });
  // A link this view cannot rewrite (one it draws itself, not written as [text](address)) can only be followed.
  if (!view.editable || !linkAt(view, a)) edit.remove();
}
