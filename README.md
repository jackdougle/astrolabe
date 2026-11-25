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

The bar at the bottom of the navigator stays the same whatever the navigator shows: files, search, command palette and settings, centred on one line (a narrow navigator splits them evenly over two). The button that shows and hides the navigator is always at the left end of the top row, beside the window's own buttons. The list of files keeps itself up to date (it is read again every two seconds, and by ⌘R), so there is no reload button. The graph's button is with the view buttons at the top right, and the hotkeys are listed under Settings.

## The terminal

zsh starts with Astrolabe's hooks added on top of your own startup files. The hooks mark where each command starts and ends, which is what gives you blocks, exit codes and the sticky command header. You type into an editor laid over the shell's cursor, so there's a smooth caret, grey suggestions from your history (Tab or → takes one) and emoji on `:`. Anything you type before the shell is ready gets held and put into the input once it is.

Your own prompt is kept by default, Powerlevel10k included. Set `"prompt": "astrolabe"` if you'd rather have the plain built-in one. bash and fish run as ordinary terminals without blocks.

Tabs are named for the folder and the running program, like `~/project claude`. A tab's dot pulses while a command runs and stops when an agent is waiting on you. If a command finishes in a tab you aren't looking at, the tab flashes and keeps a green or red mark until you visit it.

## Layout

The window has two areas side by side, the terminals and the editors, and they don't affect each other. Changing terminal tab leaves your files alone, and opening a file leaves your terminals alone.

- A terminal tab holds one terminal or several (⌘D and ⇧⌘D split it). In the row along the top, a tab is one block of a fixed length with a segment for each of its terminals.
- The first file you open brings up the editors, and closing the last one puts them away. You can have several editors side by side (⌘\), each with its own files.
- A file opens in a temporary tab with its name in italics, and the next file you open takes its place. Saving it or double-clicking it keeps the tab.
- Tabs drag anywhere. Along the row a tab changes places. Carried down among the panes, a terminal's segment or a file's tab shows an outline of where it would land: over another pane, the half of it on the pointer's side; close to a wall, that whole side; over the other area (a terminal over the editors, a file over the terminals), that side of the window, so the terminals can sit beside, above or below the editors. Out of the window, a tab gets a window of its own. The short bar at a pane's top edge drags the same way. Shells keep running through all of this.
- Right-click the top row, clear of the tabs, for something new in the area under the pointer: over the terminals a terminal (in a tab of its own, on the right, or below), over an editor a note or another editor.
- A code file's tab shows its language's logo; notes show a page. Either turns neon while the file has unsaved changes.
- An untitled note with nothing in it is deleted once it is out of sight: when its editor shows another file, or when the terminals take the whole window.
- Terminal tabs combine. Drop a tab on the middle of another and its terminals join that tab, or right-click a tab and choose Combine with Current Tab. Right-click a terminal's segment for Move Terminal to Its Own Tab, or carry the terminal by its bar up to the row: onto a tab to join it, beside the tabs for a tab of its own.
- Tabs move between windows. Drag a tab over another Astrolabe window and let go: on a terminal it lands against that terminal's nearest edge, on the row it becomes a tab, and a file opens in the editor under it. A window left empty closes.
- ⌃⌘F lets the area you're in fill the window, and ⌃⌘S swaps the two sides.

## Hiding terminals

⌘U takes the terminal you're looking at off screen without stopping it. Whatever is running in it keeps running, and it keeps its place in its tab.

While anything is hidden, a chip in the bottom right corner of the terminals says how many. Its terminal icon pulses while a command is running in one of them, like an agent working on a reply, and sits still otherwise. Click the chip for the list, and click a terminal in the list to bring it back where it was. ⇧⌘U brings them all back, and the first time you hide one a note at the top of the window reminds you of that key. Press ⇧⌘U again and the ones it brought back hide again, unless you have hidden something else in between. When you type right next to the chip it goes almost fully see-through until you move the mouse.

The window won't close while a terminal is hidden, and closing a tab leaves the terminals hidden in it alone. Quitting still ends them, like every other shell.

## Hotkeys

The keyboard button at the bottom of the navigator lists every hotkey, and you can search it. Here are the main ones.

| | |
|---|---|
| ⌘T, ⌘D, ⇧⌘D | New terminal tab, split right, split down |
| ⌘W, ⇧⌘W | Close the terminal or file you're in, close the whole tab |
| ⌘U, ⇧⌘U | Hide this terminal, bring the hidden ones back (again: hide them again) |
| ⌘1–9, ⌥⌘1–9 | Go to a terminal tab, go to an open file |
| ⌥⌘arrows, ⌃` | Move between panes, jump between the editors and the terminals |
| ⌘N, ⇧⌘N | New note in this project, new window |
| ⌘O | Open a file by name. Notes only, last edited first. A dot in the search brings in other files |
| ⌘L, ⇧⌘F, ⌘P | File navigator, search in project, command palette (⇧⌘P too) |
| ⌘E, ⌘\ | Show or hide the editors, split the editor |
| ⌃⌘F, ⌃⌘S, ⇧⌘↩ | Fill the window with one area, swap sides, maximize a pane |
| ⌘G | The graph |
| ⇧⌘B | Hide or show the top bar (the window's buttons go with it) |
| ⌘0 | Light mode on or off. Going back restores the dark theme you had (⌥⌘0 resets zoom) |
| ⇧⌘R | Markdown rendered or raw (lines always wrap; nothing scrolls sideways) |
| ⌘F | Find in the note, file or terminal you're in: every match is marked and counted, Enter and ⇧Enter step through them, ⌘F again (or Esc) closes |
| ⌘K, ⇧⌘C | Clear the terminal, copy the last block's output |
| ⇧⌘A or `/file` | Attach files. Dropping or pasting them on a terminal does the same |
| ⌥↑ ⌥↓, ⇧⌘K, ⌃L, ⌘↩ | Move a line, delete it, select it, start a new one below |
| ⌘K (or ⌥⌘Y), ⌥⌘N | Keep or undo every change an agent made to the open file |
| ⌘-click | Open a file path or link from terminal output or a note |

## Notes

Markdown opens rendered, and ⇧⌘R switches to raw. Both views edit the same text. An edit in the rendered view only rewrites the blocks it touched, so the rest of the file stays exactly as it was written, and anything the rendered view can't show safely appears as an editable source block instead.

- The line keys, bracket pairs and smooth caret work the same in both views.
- `[] ` starts a to-do, `> ` a toggle and `" ` a quote. Typing a different marker at the start of a list item converts it, along with the items after it. Toggles stand apart: `> ` turns only that one note into a toggle, and what a toggle holds starts as bullets (or, for a toggle inside a numbered list, the next numbering style).
- Numbered lists nest 1. → a. → i. → ■, counting every layer of notes. Tab and ⇧Tab move only the note you're on or the ones selected; what's nested under them stays put. Backspace on a line with nothing on it deletes the line.
- Empty lines are blank lines in the file and lists are written tight, so the raw view holds exactly what the rendered one shows.
- `> ` typed before or after a heading's `#`s, or at the start of a finished heading, makes it a toggle heading that holds its section. The arrow sits in front of the `#`s.
- `--` becomes a dash and `->` an arrow as you type. `[words](address)` becomes a link, and so does a URL pasted over a selection. With words selected, ⌘K asks for an address and ⇧⌘V links them to the one on the clipboard. Link notation left as plain characters around an address that is already a link (`\[name]\(<address>)` in the file, which is what pasting formatted text can leave) shows as the name, linked.
- A heading shows its `#`s, greyed, while the caret is on its line, and has none otherwise. They're real text, so editing them changes the level live, and typing `## ` straight after them just sets the level. Sizes step evenly from h1 (2.2× the text) down to h6, which is one pixel larger than the text.
- The file name shows as the note's title, and editing the title renames the file.
- Drop or paste a picture and it goes into the note. It's copied into `attachments/` beside the note, or uploaded if you've set `imageUpload`.
- A word count sits in the bottom right corner. Click it for characters, paragraphs and reading time. Like the hidden-terminals chip, it goes see-through when you type right next to it.

### When an agent edits a file you have open

The change goes straight into the text you're looking at, and you keep typing. Each change is marked until you've looked at it: added lines are green, the lines they replaced are red above them, and each has its own Keep and Undo. A bar at the bottom counts them and has Keep all (⌘K) and Undo all (⌥⌘N). It works rendered and raw, for notes and code.

Unsaved typing is never lost. The outside change is merged around it, and saving writes both. If the change lands on lines you've edited but not saved, your lines stay and the other version is shown under them with "Use this" and "Keep mine". Undo puts the old lines back and, if nothing else is unsaved, saves the file so the agent sees it too.

Settings > Behaviour turns the marks off. Then changes just appear, still merged around your typing.

## The graph

⌘G shows every note in the project as a point and every link between notes as a line. Linked notes pull together, lone notes settle in the gaps, and a note's colour comes from its folder. Scroll to zoom, drag to move, click a note to open it, and type in the box to find one.

## Your own commands

Three settings each name a command of yours. They're empty by default, so nothing runs and nothing gets sent anywhere until you fill one in.

- `noteTemplate` prints what a new note starts with.
- `onFileClose` runs when a file's last tab closes, with the file's path as its last argument. It can move or change the file, and its last line of output is shown as a message.
- An untitled note with nothing in it (`Untitled.md`, `Untitled 2.md`, …: only white space, or just what `noteTemplate` printed) is deleted and its tab closed as soon as you are off it, meaning its editor is showing another file, or when it is closed. One with unsaved typing or a name of its own is kept, and `onFileClose` is not run for a note cleared this way. See `src/lib/untitled.ts`.
- `imageUpload` takes a picture's path and prints a web address, which the note then uses. `scripts/upload-image.sh` does this for a Vercel Blob store.

## Updating

A running copy watches the folder it was built from. When the source changes, a notice at the top of the window offers to reload.

- If only `src/` changed, it rebuilds in about a second and every window reloads in place. Shells, scrollback, half-typed commands and unsaved edits all carry over.
- If `electron/` changed, the app has to relaunch, which ends the shells. It asks first if a command is running.
- If Electron, node-pty or the icon changed, the whole app is packaged again.

## Look

The window is translucent over a blurred desktop, with a faint starfield behind the terminals. The default theme, Meridian, is blue on near-black, and "Change theme" in the palette has the others. The terminal, notes text and note headings can each use any Google Fonts family. What programs print in a terminal is drawn in medium weight; Settings, Fonts has regular and semibold (`outputWeight` in the settings file). Opening and closing things is animated briefly, and macOS's Reduce Motion turns that off.

## Testing

```sh
node test/drive.mjs <scenario>
```

This launches the built app against a throwaway config folder and runs a scenario from `test/scenarios/`. `SHOTS=/some/dir` saves screenshots, `APP=/path/to/binary` tests an installed build, and `SETTINGS='{"prompt":"astrolabe"}'` sets settings. `hideterm` covers hidden terminals and the hotkey list.

## Not built yet

Agent integrations, notifications, code signing, dropping a tab into another window's row, and a smooth cursor inside running programs.
