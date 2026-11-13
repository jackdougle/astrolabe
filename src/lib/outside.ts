// Files opened from outside the app (`open -a Astrolabe note.md`, a file dropped on the Dock icon, a Raycast
// script) open in this window like a ⌘-clicked path. A note opens rendered with the caret at its end, so you
// can type under what is already there.
import { api } from './api';
import { bus } from './panes';
import { isMarkdown, useStore } from './store';

async function openWaiting() {
  const files = (await api.app.takeOutsideFiles?.()) ?? [];
  for (const file of files) useStore.getState().openFile(file, isMarkdown(file) ? { line: 1, end: true } : null, { keep: files.length > 1 });
  // A file a script has just made should show in the navigator too.
  if (files.length) bus.emit('fs.changed');
}

/** Call once the page is up: opens anything that arrived while it was loading, then listens for more. */
export function watchOutsideFiles() {
  api.app.onOutsideFiles?.(() => { void openWaiting(); });
  void openWaiting();
}
