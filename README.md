# Astrolabe

A terminal for macOS with a code and notes editor built in. Commands run in blocks like Warp, code edits like VS Code, and Markdown notes edit like Notion, with an Obsidian-style graph on top. It's Electron, with xterm.js for the terminal, Monaco for code and the command input, and Milkdown for rendered Markdown.

## Run it

```sh
npm install
npm run build && npm start   # run from source
npm run install-app          # build and install /Applications/Astrolabe.app
npm run icon                 # redraw the app icon
```

Settings live in `~/.astrolabe/settings.json`. ⌘, opens the file, and the gear at the bottom of the navigator has the common ones (themes, fonts, sizes, behaviour).

## The terminal

zsh starts with Astrolabe's hooks added on top of your own startup files. The hooks mark where each command starts and ends, which is what gives you blocks, exit codes and the sticky command header. You type into an editor laid over the shell's cursor, so there's a smooth caret, grey suggestions from your history (Tab or → takes one) and emoji on `:`. Anything you type before the shell is ready gets held and put into the input once it is.

Your own prompt is kept by default, Powerlevel10k included. Set `"prompt": "astrolabe"` if you'd rather have the plain built-in one. bash and fish run as ordinary terminals without blocks.

Tabs are named for the folder and the running program, like `~/project claude`. A tab's dot pulses while a command runs and stops when an agent is waiting on you. If a command finishes in a tab you aren't looking at, the tab flashes and keeps a green or red mark until you visit it.

## Layout

The window has two areas side by side, the terminals and the editors, and they don't affect each other. Changing terminal tab leaves your files alone, and opening a file leaves your terminals alone.

- A terminal tab holds one terminal or several (⌘D and ⇧⌘D split it). In the row along the top, a tab is one block of a fixed length with a segment for each of its terminals.
- The first file you open brings up the editors, and closing the last one puts them away. You can have several editors side by side (⌘\), each with its own files.
- A file opens in a temporary tab with its name in italics, and the next file you open takes its place. Saving it or double-clicking it keeps the tab.
- Tabs and panes drag. Drag a tab along the row to reorder it, drag a file onto another editor to move it there, drag a pane by the short bar at its top edge to rearrange a split, or drag a tab out of the window to give it a window of its own. Shells keep running through all of this.
- Terminal tabs combine. Drop a tab on the middle of another and its terminals join that tab, or right-click a tab and choose Combine with Current Tab. Right-click a terminal's segment for Move Terminal to Its Own Tab, or carry the terminal by its bar up to the row: onto a tab to join it, beside the tabs for a tab of its own.
- Tabs move between windows. Drag a tab over another Astrolabe window and let go: on a terminal it lands against that terminal's nearest edge, on the row it becomes a tab, and a file opens in the editor under it. A window left empty closes.
- ⌃⌘F lets the area you're in fill the window, and ⌃⌘S swaps the two sides.

## Hiding terminals

⌘U takes the terminal you're looking at off screen without stopping it. Whatever is running in it keeps running, and it keeps its place in its tab.

While anything is hidden, a chip in the bottom right corner of the terminals says how many. Its terminal icon pulses while a command is running in one of them, like an agent working on a reply, and sits still otherwise. Click the chip for the list, and click a terminal in the list to bring it back where it was. ⇧⌘U brings them all back, and the first time you hide one a note at the top of the window reminds you of that key.

The window won't close while a terminal is hidden, and closing a tab leaves the terminals hidden in it alone. Quitting still ends them, like every other shell.

## Hotkeys

The keyboard button at the bottom of the navigator lists every hotkey, and you can search it. Here are the main ones.

| | |
|---|---|
| ⌘T, ⌘D, ⇧⌘D | New terminal tab, split right, split down |
| ⌘W, ⇧⌘W | Close the terminal or file you're in, close the whole tab |
| ⌘U, ⇧⌘U | Hide this terminal, bring the hidden ones back |
| ⌘1–9, ⌥⌘1–9 | Go to a terminal tab, go to an open file |
| ⌥⌘arrows, ⌃` | Move between panes, jump between the editors and the terminals |
| ⌘N, ⇧⌘N | New note in this project, new window |
| ⌘O or ⌘P | Open a file by name. Notes only, last edited first. A dot in the search brings in other files |
| ⌘L, ⇧⌘F, ⇧⌘P | File navigator, search in project, command palette |
| ⌘E, ⌘\ | Show or hide the editors, split the editor |
| ⌃⌘F, ⌃⌘S, ⇧⌘↩ | Fill the window with one area, swap sides, maximize a pane |
| ⌘G | The graph |
| ⇧⌘R, ⌥Z | Markdown rendered or raw, word wrap |
| ⌘K, ⌘F, ⇧⌘C | Clear the terminal, find in it, copy the last block's output |
| ⇧⌘A or `/file` | Attach files. Dropping or pasting them on a terminal does the same |
| ⌥↑ ⌥↓, ⇧⌘K, ⌃L, ⌘↩ | Move a line, delete it, select it, start a new one below |
| ⌘-click | Open a file path or link from terminal output or a note |

## Notes

Markdown opens rendered, and ⇧⌘R switches to raw. Both views edit the same text. An edit in the rendered view only rewrites the blocks it touched, so the rest of the file stays exactly as it was written, and anything the rendered view can't show safely appears as an editable source block instead.

- The line keys, bracket pairs and smooth caret work the same in both views.
- `[] ` starts a to-do, `> ` a toggle and `" ` a quote. Typing a different marker at the start of a list item converts it, along with the items after it.
- `--` becomes a dash and `->` an arrow as you type. `[words](address)` becomes a link, and so does a URL pasted over a selection.
- A heading shows its `#`s only while the caret is on it. They're real text, so you can edit them to change the level.
- The file name shows as the note's title, and editing the title renames the file.
- Drop or paste a picture and it goes into the note. It's copied into `attachments/` beside the note, or uploaded if you've set `imageUpload`.
- A word count sits in the bottom right corner. Click it for characters, paragraphs and reading time.

An open file reloads by itself when an agent or another program changes it on disk. A file with unsaved typing is left alone, and you get a notice instead.

## The graph

⌘G shows every note in the project as a point and every link between notes as a line. Linked notes pull together, lone notes settle in the gaps, and a note's colour comes from its folder. Scroll to zoom, drag to move, click a note to open it, and type in the box to find one.

## Your own commands

Three settings each name a command of yours. They're empty by default, so nothing runs and nothing gets sent anywhere until you fill one in.

- `noteTemplate` prints what a new note starts with.
- `onFileClose` runs when a file's last tab closes, with the file's path as its last argument. It can move or change the file, and its last line of output is shown as a message.
- `imageUpload` takes a picture's path and prints a web address, which the note then uses. `scripts/upload-image.sh` does this for a Vercel Blob store.

## Updating

A running copy watches the folder it was built from. When the source changes, a notice at the top of the window offers to reload.

- If only `src/` changed, it rebuilds in about a second and every window reloads in place. Shells, scrollback, half-typed commands and unsaved edits all carry over.
- If `electron/` changed, the app has to relaunch, which ends the shells. It asks first if a command is running.
- If Electron, node-pty or the icon changed, the whole app is packaged again.

## Look

The window is translucent over a blurred desktop, with a faint starfield behind the terminals. The default theme, Meridian, is blue on near-black, and "Change theme" in the palette has the others. The terminal, notes text and note headings can each use any Google Fonts family. Opening and closing things is animated briefly, and macOS's Reduce Motion turns that off.

## Testing

```sh
node test/drive.mjs <scenario>
```

This launches the built app against a throwaway config folder and runs a scenario from `test/scenarios/`. `SHOTS=/some/dir` saves screenshots, `APP=/path/to/binary` tests an installed build, and `SETTINGS='{"prompt":"astrolabe"}'` sets settings. `hideterm` covers hidden terminals and the hotkey list.

## Not built yet

Agent integrations, notifications, code signing, find in the rendered Markdown view, dropping a tab into another window's row, and a smooth cursor inside running programs.
