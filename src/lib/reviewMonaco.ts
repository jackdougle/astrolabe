// Draws the changes waiting to be looked at (review.ts) in the raw view and in code: added lines tinted green,
// the lines they replaced in red above them, and Keep / Undo at the top right of each change.
import type * as monacoNs from 'monaco-editor';
import { monaco } from './monaco';
import { keep, spans, subscribe, undo } from './review';
import type { Span } from './review';

type Editor = monacoNs.editor.IStandaloneCodeEditor;

export function attachReview(editor: Editor): () => void {
  const marks = editor.createDecorationsCollection();
  let zones: string[] = [];
  let pills: { widget: monacoNs.editor.IOverlayWidget; node: HTMLElement; span: Span; above: number }[] = [];
  let drawn = '';

  /** A block of lines that are not in the text: the old ones (red) or the offered ones (green). */
  const block = (lines: string[], cls: string) => {
    const node = document.createElement('div');
    node.className = `rv-zone ${cls}`;
    for (const line of lines) { const row = document.createElement('div'); row.textContent = line || ' '; node.append(row); }
    return node;
  };
  /** How tall it will be at the editor's width, lines wrapped as the editor wraps them. */
  const heightOf = (node: HTMLElement) => {
    const info = editor.getLayoutInfo();
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${Math.max(40, info.contentWidth - info.verticalScrollbarWidth)}px`;
    editor.applyFontInfo(probe);
    probe.append(node);
    editor.getDomNode()?.append(probe);
    const h = node.offsetHeight;
    probe.remove();
    return h;
  };
  const button = (label: string, cls: string, run: () => void) => {
    const el = document.createElement('button');
    el.className = cls; el.textContent = label; el.type = 'button';
    el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); editor.focus(); });
    return el;
  };

  const place = () => {
    const height = editor.getLayoutInfo().height;
    const scroll = editor.getScrollTop();
    const model = editor.getModel();
    for (const p of pills) {
      const last = model?.getLineCount() ?? 1;
      const line = Math.min(p.span.start, last);
      // Below the last line when the change sits past the end of the file.
      const top = editor.getTopForLineNumber(line) + (p.span.start > last ? editor.getOption(monaco.editor.EditorOption.lineHeight) : 0) - p.above - scroll;
      p.node.style.top = `${top + 1}px`;
      p.node.style.display = top < -4 || top > height - 12 ? 'none' : '';
    }
  };

  const clear = () => {
    marks.clear();
    if (zones.length) editor.changeViewZones((acc) => { zones.forEach((id) => acc.removeZone(id)); });
    zones = [];
    pills.forEach((p) => editor.removeOverlayWidget(p.widget));
    pills = [];
    drawn = '';
  };

  const draw = () => {
    const model = editor.getModel();
    const list = model ? spans(model) : [];
    const width = editor.getLayoutInfo().contentWidth;
    const sig = list.map((s) => `${s.id}:${s.start}-${s.end}:${(s.offer ?? s.old).length}`).join(';') + `|${model?.uri.toString() ?? ''}|${width}`;
    if (sig === drawn) { place(); return; }
    clear();
    if (!model || !list.length) return;
    drawn = sig;
    const last = model.getLineCount();
    marks.set(list.filter((s) => s.end >= s.start).map((s) => ({
      range: { startLineNumber: s.start, startColumn: 1, endLineNumber: s.end, endColumn: 1 },
      options: { isWholeLine: true, className: s.offer ? 'rv-mine' : 'rv-add', linesDecorationsClassName: s.offer ? 'rv-mine-bar' : 'rv-add-bar', overviewRuler: { color: s.offer ? '#d9a13a88' : '#3fb95088', position: monaco.editor.OverviewRulerLane.Full } },
    })));
    const above = new Map<string, number>();
    editor.changeViewZones((acc) => {
      for (const s of list) {
        const lines = s.offer ?? s.old;
        if (!lines.length) continue;
        const node = block(lines, s.offer ? 'rv-new' : 'rv-old');
        const h = heightOf(node);
        // Old lines go above the change; offered lines below your own.
        const after = s.offer ? Math.min(last, Math.max(s.end, s.start - 1)) : Math.min(last, s.start - 1);
        zones.push(acc.addZone({ afterLineNumber: after, heightInPx: h, domNode: node, suppressMouseDown: true }));
        if (!s.offer) above.set(s.id, h);
      }
    });
    for (const s of list) {
      const node = document.createElement('div');
      node.className = `rv-actions rv-pill${s.offer ? ' is-offer' : ''}`;
      node.dataset.change = s.id;
      if (s.offer) node.append(button('Use theirs', 'rv-undo', () => undo(model, s.id)), button('Keep mine', 'rv-keep', () => keep(model, s.id)));
      else node.append(button('Keep', 'rv-keep', () => keep(model, s.id)), button('Undo', 'rv-undo', () => undo(model, s.id)));
      const widget: monacoNs.editor.IOverlayWidget = { getId: () => `astrolabe.review.${s.id}`, getDomNode: () => node, getPosition: () => null };
      editor.addOverlayWidget(widget);
      pills.push({ widget, node, span: s, above: above.get(s.id) ?? 0 });
    }
    place();
  };

  let frame = 0;
  const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
  const subs = [
    editor.onDidChangeModel(later), editor.onDidScrollChange(place), editor.onDidLayoutChange(later), editor.onDidContentSizeChange(place),
  ];
  const off = subscribe(later);
  later();
  return () => { off(); subs.forEach((s) => s.dispose()); cancelAnimationFrame(frame); clear(); };
}

/** Scrolls to the next change after the caret (or the first), and puts the caret on it. */
export function revealNext(editor: Editor, back = false) {
  const model = editor.getModel();
  const list = model ? spans(model) : [];
  if (!model || !list.length) return;
  const line = editor.getPosition()?.lineNumber ?? 1;
  const next = back ? [...list].reverse().find((s) => s.start < line) ?? list[list.length - 1] : list.find((s) => s.start > line) ?? list[0];
  const at = Math.min(next.start, model.getLineCount());
  editor.setPosition({ lineNumber: at, column: 1 });
  editor.revealLineInCenterIfOutsideViewport(at);
}
