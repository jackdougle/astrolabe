import { contextBridge, ipcRenderer, webUtils } from 'electron';

type Unsub = () => void;
function on(channel: string, fn: (...args: any[]) => void): Unsub {
  const listener = (_e: unknown, ...args: any[]) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// A window reloading in place shows a picture of itself, taken just before, until the new page has drawn
// (the main process keeps it), so the reload is not seen as a blink. The page draws unseen beneath it: the
// window is see-through, and two layers of it would show as a moment of darker glass.
let cover: HTMLElement[] = [];
const shot = ipcRenderer.sendSync('app:shot') as number;
if (shot) {
  const put = () => {
    if (!document.documentElement) return false;
    const img = document.createElement('img');
    img.src = `astrolabe://app/__shot/${shot}.png`;
    img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none';
    const hide = document.createElement('style');
    hide.textContent = '#root{opacity:0!important}';
    cover = [img, hide];
    document.documentElement.append(hide, img);
    return true;
  };
  if (!put()) {
    const seen = new MutationObserver(() => { if (put()) seen.disconnect(); });
    seen.observe(document, { childList: true });
  }
}
function uncover() {
  for (const el of cover) el.remove();
  cover = [];
}

const api = {
  pty: {
    spawn: (id: string, opts: { cwd?: string; cols: number; rows: number; prompt?: 'own' | 'native' }) => ipcRenderer.invoke('pty:spawn', id, opts),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    /** Takes over a shell that was left running by the page this one replaced. False if it has gone. */
    attach: (id: string) => ipcRenderer.invoke('pty:attach', id) as Promise<boolean>,
    onData: (fn: (id: string, data: string) => void) => on('pty:data', fn),
    onExit: (fn: (id: string, code: number) => void) => on('pty:exit', fn),
  },
  fs: {
    readDir: (dir: string) => ipcRenderer.invoke('fs:readDir', dir),
    readFile: (file: string) => ipcRenderer.invoke('fs:readFile', file),
    writeFile: (file: string, text: string) => ipcRenderer.invoke('fs:writeFile', file, text),
    stat: (file: string) => ipcRenderer.invoke('fs:stat', file),
    listFiles: (root: string) => ipcRenderer.invoke('fs:listFiles', root),
    complete: (cwd: string, token: string) => ipcRenderer.invoke('fs:complete', cwd, token),
    newNote: (dir: string, template?: string) => ipcRenderer.invoke('fs:newNote', dir, template),
    rename: (from: string, name: string) => ipcRenderer.invoke('fs:rename', from, name) as Promise<{ path?: string; error?: string }>,
    move: (from: string, dir: string) => ipcRenderer.invoke('fs:move', from, dir) as Promise<{ path?: string; error?: string }>,
    trash: (target: string) => ipcRenderer.invoke('fs:trash', target) as Promise<{ ok: boolean; error?: string }>,
    createFile: (dir: string, name: string) => ipcRenderer.invoke('fs:createFile', dir, name) as Promise<{ path?: string; error?: string }>,
    discardBlank: (file: string, text: string) => ipcRenderer.invoke('fs:discardBlank', file, text) as Promise<boolean>,
    treeMenu: (on: 'file' | 'dir' | 'blank', count?: number) => ipcRenderer.invoke('tree:menu', on, count) as Promise<'newFile' | 'rename' | 'trash' | 'reveal' | null>,
    headerMenu: () => ipcRenderer.invoke('editor:menu') as Promise<'newFile' | null>,
    watch: (paths: string[]) => ipcRenderer.send('fs:watch', paths),
    onFileChanged: (fn: (path: string) => void) => on('fs:fileChanged', fn),
    testMenuChoice: (choice: string) => ipcRenderer.send('test:menuChoice', choice),
    confirmUnsaved: (name: string) => ipcRenderer.invoke('dialog:unsaved', name) as Promise<'save' | 'discard' | 'cancel'>,
    pick: (defaultPath?: string) => ipcRenderer.invoke('dialog:pickFiles', defaultPath) as Promise<string[]>,
    pathOf: (file: File) => webUtils.getPathForFile(file),
    /** Saves pasted or dropped bytes that have no file on disk, and says where. */
    importImage: (noteDir: string, from: string) => ipcRenderer.invoke('fs:importImage', noteDir, from) as Promise<{ path?: string; error?: string }>,
    uploadImage: (command: string, file: string) => ipcRenderer.invoke('fs:uploadImage', command, file) as Promise<{ url?: string; error?: string }>,
    fileClosed: (command: string, file: string) => ipcRenderer.invoke('fs:fileClosed', command, file) as Promise<{ said?: string; error?: string }>,
    savePasted: (name: string, data: Uint8Array) => ipcRenderer.invoke('fs:savePasted', name, data) as Promise<{ path?: string; error?: string }>,
  },
  shell: {
    commands: () => ipcRenderer.invoke('shell:commands'),
    history: () => ipcRenderer.invoke('shell:history'),
  },
  fonts: { list: () => ipcRenderer.invoke('fonts:list') as Promise<{ family: string; category: string }[]> },
  git: { info: (cwd: string) => ipcRenderer.invoke('git:info', cwd) },
  search: { run: (opts: unknown) => ipcRenderer.invoke('search:run', opts) },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    zoom: (factor: number) => ipcRenderer.send('app:zoom', factor),
    unsavedCount: (n: number) => ipcRenderer.send('app:unsavedCount', n),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate') as Promise<'dev' | 'no-source' | 'current' | 'reload' | 'relaunch' | 'busy'>,
    /** `running` is how many terminals have a command going, which a relaunch would end. */
    installUpdate: (running: number) => ipcRenderer.invoke('app:installUpdate', running) as Promise<{ ok: boolean; detail?: string }>,
    /** What the page this one replaced left for it (see src/lib/handoff.ts), or null on an ordinary start. */
    takeHandoff: () => ipcRenderer.invoke('app:takeHandoff') as Promise<Record<string, unknown> | null>,
    /** `fn` gathers this page's state when the window is about to reload in place. */
    onPrepareReload: (fn: () => Promise<unknown>) => {
      ipcRenderer.on('app:prepareReload', async (_e, token: number) => {
        let data: unknown = null;
        try { data = await fn(); } catch {}
        ipcRenderer.send('app:handoff', token, data);
      });
    },
    /** The page is drawn and has its terminals back. */
    booted: () => { uncover(); ipcRenderer.send('app:booted'); },
    bootFailed: () => ipcRenderer.send('app:bootFailed'),
    openExternal: (url: string) => ipcRenderer.send('app:openExternal', url),
    reveal: (file: string) => ipcRenderer.send('app:reveal', file),
    reloadWindow: () => ipcRenderer.send('app:reloadWindow'),
    toggleDevTools: () => ipcRenderer.send('app:toggleDevTools'),
    newWindow: () => ipcRenderer.send('app:newWindow'),
    /** A tab is being dragged outside the window: shows the outline of the window it would become there (null: it came back). */
    tearOver: (spec: unknown) => ipcRenderer.send('tear:over', spec),
    /** That tab was let go out there, and becomes that window (null: the drag was called off). */
    tearDrop: (spec: unknown) => ipcRenderer.send('tear:drop', spec),
    /** `fn` hands over a tab that is leaving for a window of its own: what the new page needs to carry on with it. */
    onPrepareMove: (fn: (what: unknown) => Promise<unknown>) => {
      ipcRenderer.on('app:prepareMove', async (_e, token: number, what: unknown) => {
        let data: unknown = null;
        try { data = await fn(what); } catch {}
        ipcRenderer.send('app:handoff', token, data);
      });
    },
    /** A tab dragged out of another window is over this one, at a point of this page (null: it has gone). */
    onTearHover: (fn: (over: unknown) => void) => on('tear:hover', fn),
    /** That tab was let go over this window: `fn` takes it in, and says whether it could. */
    onAdopt: (fn: (data: unknown, at: unknown) => Promise<unknown>) => {
      ipcRenderer.on('app:adopt', async (_e, token: number, arg: { data: unknown; at: unknown }) => {
        let ok: unknown = false;
        try { ok = await fn(arg?.data, arg?.at); } catch {}
        ipcRenderer.send('app:handoff', token, ok ? { ok: true } : null);
      });
    },
    /** The right-click menu of a terminal tab. `join`: it can be combined with the tab in front; `part`: the
     *  terminal clicked can leave for a tab of its own. */
    tabMenu: (opts: { join: boolean; part: boolean }) => ipcRenderer.invoke('tab:menu', opts) as Promise<'join' | 'part' | 'close' | null>,
    /** A right-click menu the page describes: rows with an id and a label, `null` for a line between them. Gives the
     *  id of the row chosen. */
    menu: (items: ({ id: string; label: string; enabled?: boolean } | null)[]) => ipcRenderer.invoke('app:menu', items) as Promise<string | null>,
    closeWindow: () => ipcRenderer.send('app:closeWindow'),
    /** Shows or hides the window's own close, minimise and zoom buttons (they go with the top bar). */
    windowButtons: (show: boolean) => ipcRenderer.send('win:buttons', show),
    onMenuCommand: (fn: (cmd: string) => void) => on('menu:command', fn),
    onFullscreen: (fn: (on: boolean) => void) => on('win:fullscreen', fn),
    onFocus: (fn: (on: boolean) => void) => on('win:focus', fn),
    /** Files handed to the app from outside (`open -a Astrolabe note.md`): `onOutsideFiles` says some are waiting
     *  and `takeOutsideFiles` collects them. */
    onOutsideFiles: (fn: () => void) => on('app:outsideFiles', fn),
    takeOutsideFiles: () => ipcRenderer.invoke('app:takeOutsideFiles') as Promise<string[]>,
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (data: unknown) => ipcRenderer.invoke('settings:save', data),
  },
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (data: unknown) => ipcRenderer.invoke('state:save', data),
  },
  clipboard: {
    write: (text: string) => ipcRenderer.send('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
  },
};

contextBridge.exposeInMainWorld('astrolabe', api);
export type AstrolabeApi = typeof api;
