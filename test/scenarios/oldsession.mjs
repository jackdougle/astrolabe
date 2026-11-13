// A session saved before terminals and editors were parted (STATE, see below) opens in the present shape: each tab
// keeps its terminals, and every file that was open is in the one editor. Run with
// STATE='{"session":{"activeTab":"tabA","tabs":[{"id":"tabA","root":{"type":"split","id":"s1","dir":"row","ratio":0.5,"a":{"type":"leaf","pane":"t1"},"b":{"type":"leaf","pane":"e1"}},"activePane":"e1","maximized":false},{"id":"tabB","root":{"type":"split","id":"s2","dir":"row","ratio":0.5,"a":{"type":"split","id":"s3","dir":"col","ratio":0.5,"a":{"type":"leaf","pane":"t2"},"b":{"type":"leaf","pane":"t3"}},"b":{"type":"leaf","pane":"e2"}},"activePane":"e2","maximized":false},{"id":"tabC","root":{"type":"leaf","pane":"e3"},"activePane":"e3","maximized":false}],"panes":{"t1":{"id":"t1","kind":"terminal","cwd":"$WORK"},"t2":{"id":"t2","kind":"terminal","cwd":"$WORK"},"t3":{"id":"t3","kind":"terminal","cwd":"$WORK/notes"},"e1":{"id":"e1","kind":"editor","files":[{"path":"$WORK/main.py","rendered":false}],"active":"$WORK/main.py"},"e2":{"id":"e2","kind":"editor","files":[{"path":"$WORK/notes/plan.md","rendered":true},{"path":"$WORK/main.py","rendered":false}],"active":"$WORK/notes/plan.md"},"e3":{"id":"e3","kind":"editor","files":[{"path":"$WORK/data.json","rendered":false}],"active":"$WORK/data.json"}}}}'
export default async function ({ page, shot }) {
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => {
    const s = window.__store.getState();
    const name = (p) => p.split('/').pop();
    return JSON.stringify({
      tabs: s.tabs.map((t) => `${t.id}${t.id === s.activeTab ? '*' : ''}: ${JSON.stringify(t.root).match(/"pane":"\w+"/g).map((m) => m.slice(8, -1)).join(',')}`),
      editors: s.editors.root && JSON.stringify(s.editors.root), files: Object.values(s.panes).filter((p) => p.kind === 'editor').map((p) => `${p.id}: ${p.files.map((f) => name(f.path)).join(',')} (showing ${name(p.active ?? '')})`),
      focus: s.focus, areas: s.areas, panes: Object.keys(s.panes),
      row: [...document.querySelectorAll('.zone')].map((z) => `${z.classList.contains('is-tabs') ? 'tabs' : 'files'}: ${[...z.querySelectorAll('.tab-group')].length || ''} ${[...z.querySelectorAll('.filetab-name')].map((f) => f.textContent).join(',')}`),
      onScreen: [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden').map((p) => p.dataset.pane),
    }, null, 1);
  }));
  await shot('oldsession');
}
