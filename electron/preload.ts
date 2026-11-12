import { contextBridge, ipcRenderer, webUtils } from 'electron';

type Unsub = () => void;
function on(channel: string, fn: (...args: any[]) => void): Unsub {
  const listener = (_e: unknown, ...args: any[]) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  pty: {
    spawn: (id: string, opts: { cwd?: string; cols: number; rows: number; prompt?: 'own' | 'native' }) => ipcRenderer.invoke('pty:spawn', id, opts),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
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
    newNote: (dir: string, stamped?: boolean) => ipcRenderer.invoke('fs:newNote', dir, stamped),
    rename: (from: string, name: string) => ipcRenderer.invoke('fs:rename', from, name) as Promise<{ path?: string; error?: string }>,
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
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate') as Promise<'dev' | 'no-source' | 'current' | 'available' | 'busy'>,
    installUpdate: () => ipcRenderer.invoke('app:installUpdate') as Promise<{ ok: boolean; detail?: string }>,
    openExternal: (url: string) => ipcRenderer.send('app:openExternal', url),
    reveal: (file: string) => ipcRenderer.send('app:reveal', file),
    newWindow: () => ipcRenderer.send('app:newWindow'),
    closeWindow: () => ipcRenderer.send('app:closeWindow'),
    onMenuCommand: (fn: (cmd: string) => void) => on('menu:command', fn),
    onFullscreen: (fn: (on: boolean) => void) => on('win:fullscreen', fn),
    onFocus: (fn: (on: boolean) => void) => on('win:focus', fn),
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
