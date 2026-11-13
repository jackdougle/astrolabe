// Pictures in a rendered note. The file says where a picture is: a web address, or a path that starts from the
// note's own folder. The page cannot load a file by its path, so a path is shown through the app's own address
// for files on disk (`__file` in electron/main.ts); what is written in the note stays as it was.
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose, $view } from '@milkdown/kit/utils';
import { dirname, joinPath } from './api';

/** The address to load the picture written as `src` in a note that lives in the folder `dir`. */
export function imageAddress(src: string, dir: string) {
  if (!src || /^(https?|data|blob|astrolabe):/i.test(src)) return src;
  let path = src.replace(/^file:\/\//i, '');
  try { path = decodeURI(path); } catch { /* as written, then */ }
  return `astrolabe://app/__file${encodeURI(joinPath(dir, path)).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

export const imageView = $view(imageSchema.node, () => (node, view) => {
  const dom = document.createElement('img');
  const show = () => {
    const file = view.dom.closest<HTMLElement>('[data-file]')?.dataset.file;
    dom.src = imageAddress(node.attrs.src, file ? dirname(file) : '/');
    dom.alt = node.attrs.alt;
    if (node.attrs.title) dom.title = node.attrs.title; else dom.removeAttribute('title');
  };
  show();
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      show();
      return true;
    },
  };
});

// Files dropped on a note are taken by the app (App.tsx), which makes them part of the note; the editor's own
// handling of a drop would add whatever else came with them (a picture dragged out of a browser brings its HTML).
export const imageDrops = $prose(() => new Plugin({
  props: { handleDrop: (_view, event) => !!(event as DragEvent).dataTransfer?.files.length },
}));
