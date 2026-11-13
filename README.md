# Astrolabe

A block-based terminal with a built-in code and notes editor, for macOS. Electron, xterm.js for the terminal, Monaco (the VS Code editor) for code and the command input, Milkdown for editable rendered Markdown.

## Run it

```sh
npm install
npm run build && npm start      # run from source
npm run install-app             # build and install /Applications/Astrolabe.app
npm run icon                    # redraw the app icon from scripts/icon_svg.py
```

Settings live in `~/.astrolabe/settings.json` (⌘, opens it). `startDirectory` sets where new terminal tabs open. `scrollSpeed` (default 2.5) multiplies scroll distance in terminals, the editor, rendered notes and the navigator. The shell integration is written to `~/.astrolabe/shell/zsh` on each launch.

## How the terminal works

zsh starts with `ZDOTDIR` pointed at Astrolabe's shims, which source your own startup files and then add hooks. The hooks mark where each command starts and ends, which gives blocks, exit codes and the sticky command header. What you type goes into a Monaco editor laid over the shell's cursor, so the input has a smooth caret, grey suggestions (your history first, skipping commands whose folder or file is gone, then command, git and file names; `cd` only offers folders) and emoji. Anything typed, pasted or dictated before a shell is ready for it is held and put into the input once it is. While a command runs, the keyboard goes straight to the program; whatever the program leaves unread is handed to the input at the next prompt instead of landing in the shell's own line.

There are two prompt modes (`"prompt"` in settings):

- `"shell"` (default): your own prompt is kept, Powerlevel10k included. The input sits at its cursor. Nerd Font symbols are bundled as a fallback, so prompt glyphs render with any typeface.
- `"astrolabe"`: the app draws a plain prompt with a header row per block (folder, branch, duration). Powerlevel10k is switched off inside Astrolabe in this mode.

Other shells (bash, fish) run as a plain terminal without blocks.

## Shortcuts

| | |
|---|---|
| ⌘D / ⇧⌘D | Split right / down: always a new terminal, beside the one used last, wherever the keyboard is |
| ⌘T | New terminal tab; in the editor, a new `Untitled.md` beside the open file |
| ⇧⌘T | New terminal tab from anywhere |
| ⌘N | New note at the top of this project (the terminal's git repo, else its folder), starting with `*11.11.2026 - 2520 Milvia St*` from CoreLocationCLI (`???` if the street can't be found). Closed with nothing added, the note is deleted again; one you typed in and saved, or gave a name, is kept. ⇧⌘N is a new window |
| ⌘1–9 | Go to a terminal tab, from the editor as well. Each tab is one block over the terminals, with its number at its end. ⌘9 is the last |
| ⌥⌘1–9 | Go to an open file, counted left to right as the file tabs sit over the editors, from a terminal as well (the numbers show on the tabs; ⌥⌘9 is the last) |
| ⌃Tab, ⌃⇧Tab | Next / previous terminal tab |
| ⌘W / ⇧⌘W | Close the file or terminal you are in (asks first if the file has unsaved changes) / close the file, or the whole terminal tab with every terminal in it. The last terminal closes like any other: while files are open, the editors are left with the window, and ⌃⌘F brings a new terminal back on half of it (⌘D and ⌘T make one too). With no file open, closing the last terminal closes the window; closing the last file leaves the terminals |
| ⌥⌘arrows, ⌘[ ⌘] | Move between panes (the arrows cross between terminals and editors) |
| ⌃` | Switch between the editors and the terminals, into the pane used last on the other side |
| ⇧⌘↩ | Maximize or restore the pane |
| Drag a pane's grip | Move the pane. With more than one pane in its area, the pane under the pointer shows a short bar at the middle of its top edge. Drag it over another pane and let go: it lands against that pane's nearest edge, sharing its space half and half; an outline shows where. At the very rim it takes that whole side. Terminals move among the terminals of their tab and editors among the editors; shells keep running. Esc calls it off. `test/scenarios/panedrag.mjs` checks this |
| ⌃⌘F or Fn+F | With terminals and files side by side: the area you are in fills the window. Pressed again: the other comes back beside it. With no file open you get an empty `Untitled.md` beside the terminals (deleted again if closed with nothing typed). Also the expand button at the top right |
| ⌘E | Show the editors, or put them away with their files as they are. It never makes a file: with none open, the editor it shows is empty and asks for a name (Enter makes that file in the project folder; a name with no ending becomes a note), and ⌘E again takes the empty editor away |
| ⌘G | The graph: the notes of this project as a network, in a tab of the editor (see "The graph") |
| ⌃⌘S, ⌃⌘← / ⌃⌘→ | Switch displays (swap the editors and the terminals), or put the editors left or right (`editorSide` in settings remembers it) |
| ⌘\ / ⇧⌘\ | Split the editor: the file you are in shows again in a second editor on the right / below. ⌘O there then brings another file into that editor, so two files sit side by side |
| ⌘L (also ⌘B, except in a rendered note, where ⌘B makes text bold) | File navigator. The file open in the editor is always on show there: the folders above it open and its name is lit in blue. ⌥-click a file to open it to the side, in a new editor. (Also: right-click anywhere for New File, which goes inside the folder you clicked, beside the file you clicked, or at the top of the project; right-click an entry to rename it, move it to the Trash, or reveal it in Finder; ⌘-click adds or drops a row from the selection and ⇧-click takes a run of rows, and right-clicking one of several selected rows moves them all to the Trash. Rows are dragged as in VS Code: onto a folder, or a file inside it, to move them there (a closed folder opens when the pointer rests on it); onto the empty space below the rows to move them to the top of the project; onto a terminal to paste the file's text on the command line, or to the program running there; onto an editor to open them. A row that is one of several selected takes the others along, open tabs follow their files, and Esc calls it off. `test/scenarios/treedrag.mjs` checks this) |
| ⇧⌘F, ⌘P or ⌘O, ⇧⌘P | Search in project, open file by name (Enter opens it in the editor used last; ⌘↩ opens it to the side, in a new editor), command palette. The file picker shows notes (Markdown) only, last edited first: before you type, and among the notes whose name holds every word you typed; looser matches follow, best first. A dot anywhere in the search (`.ts`, `main.py`) brings in every other kind of file. It leaves out everything inside dot folders (`.git`, `.venv`, `.claude`) unless the search has a part that starts with a dot. `test/scenarios/picker.mjs` checks this |
| ⇧⌘A, or type `/file` | Attach files from Finder. Dropping files on a pane does the same, and so does pasting them (⌘V) into a terminal: their paths go to the command line, or to the program running there, so an agent gets a pasted image. A screenshot on the clipboard, or a picture dragged out of a browser, has no file behind it and is saved under `~/.astrolabe/pasted` first (cleared after two weeks). `test/scenarios/pastefile.mjs` checks this. In a note, a picture goes into the note itself (see "Pictures in notes") |
| ⌘K, ⌘F | Clear terminal, find in terminal |
| ⌘↑ / ⌘↓, ⇧⌘C | Select blocks, copy a block's output |
| Tab or →, ↑ or ⌃P, ⌃R | Accept the grey suggestion (there is no completion menu), previous command, search history |
| ⌃W, ⌃U, ⌃C, ⌃A, ⌃E, ⌃K | The usual line-editing keys in the command input |
| `:` | Emoji suggestions; a finished `:sob:` becomes 😭 |
| ⇧⌘R (also ⇧⌘V) | Markdown: rendered or raw (both editable) |
| ⌘R | Bring this copy up to date with its source folder, from anywhere, the editor included (see "Updating a running copy") |
| ⌥⌘R | Reload the window where it stands; terminals keep running |
| ⌥Z | Word wrap |
| ⌥↑ / ⌥↓, ⇧⌥↑ / ⇧⌥↓ | Move the line (or the selected lines) up or down; copy it above or below. Raw and rendered |
| ⇧⌘K, ⌃L, ⌘↩ | Delete the line; select it (again takes the next one too); new line below. Raw and rendered |
| ⌥⌘C in the editor | Copy the full path of the open file, to link it elsewhere (VS Code's key for it) |
| ⌘] / ⌘[, Tab / ⇧Tab | Indent or outdent a list item. Raw and rendered |
| `(` `[` `` ` `` `*` `_` over a selection | Go around it instead of replacing it. Raw and rendered (there `*` is italic, `**` bold, `` ` `` code) |
| ⇧⌘X | Strike through the selection, or take the strike away. Raw (it puts `~~` around the selection, or the word at the caret) and rendered. A typed `~` is always just a tilde, and in a file only `~~two tildes~~` strike words through |
| ⌘↩ on a task's line | Tick or untick it (raw and rendered) |
| `[]`, `> `, `" ` opening a line (rendered) | A to-do (a bullet becomes one), a toggle, a quote, as in Notion |
| `- ` (or `* `), `> ` opening a line that is already a list item (rendered) | The item changes kind: `- ` makes a to-do, a numbered item or a toggle a plain bullet; `> ` makes a bullet, a to-do or a numbered item a toggle, with whatever was nested under it inside. Enter under a ticked to-do starts an unticked one. Tab and ⇧Tab slide the line to its new indent. `test/scenarios/listtypes.mjs` checks these |
| `--`, `->`, `-->`, `<-`, `<--`, `<->`, `<-->`, `=>`, `==>`, `<==`, `<=>`, `<==>` (rendered) | Become — → ⟶ ← ⟵ ↔ ⟷ ⇒ ⟹ ⟸ ⇔ ⟺ as typed, outside code; Backspace straight after puts back what was typed. `---` opening a line still draws a line |
| `[words](address)` typed out (rendered) | Becomes the words, linked, as the closing bracket goes in; the file and the raw view keep the notation. Not for pictures (`![…](…)`) or inside code |
| ⌘↩ in a toggle's title, or a click on its arrow | Open or close it |
| ⌘X or ⌘C with nothing selected | Cut or copy the line (editor only); in a rendered note, the paragraph, heading, list item or code line |
| ⌘-click | Open a file path or link from terminal output (`path:12`, `#L12` and Claude Code's `file://` links open at the line), or a file link in a rendered note; a link broken over several rows opens from any piece |

Hovering a button shows its name and shortcut. Right-clicking a file's tab offers "New File", which makes an `Untitled.md` beside that file (the same as ⌘T).

A file handed over from outside opens in the window in front: `open -a Astrolabe note.md` from a script, or a file dropped on the Dock icon. A note opens rendered with the caret at its end; a file that arrives while the app is starting waits for the first window. The `mtg` Raycast command (`~/brain2/scripts/new-meeting-note.sh`) uses this to make a stamped meeting note in `people/` and put you in it. `test/scenarios/outside.mjs` checks this.

## Panes and tabs

The window has two areas side by side that know nothing of each other: the terminals and the editors.

- **Terminals.** A terminal tab holds one terminal or several, split with ⌘D and ⇧⌘D. Tabs are numbered ⌘1–9.
- **Editors.** The first file you open brings up the editor area beside the terminals; closing the last file takes it away. An editor holds any number of files and shows one. There can be several editors (⌘\, ⌘↩ in the file picker, ⌥-click in the navigator, or a file tab dragged onto an editor's edge), each with its own files. Files are numbered ⌥⌘1–9.
- **They are independent.** Changing terminal tab leaves the files as they are; opening or closing files leaves the terminals as they are. A file always opens in the editor used last, whichever terminal it was opened from.
- **The row along the top is cut where the window is.** The stretch over the terminals holds the terminal tabs; the stretch over each editor holds that editor's files. Drag the line between the areas and the row follows. When one area fills the window (⌃⌘F), the row keeps both stretches, so a click on a tab on the hidden side brings that side back.
- **A terminal tab is one block of a fixed length.** Splitting the tab divides its block into a segment for each terminal (the one with the keyboard gets the most room; a long folder name gives way to the program's name) and never makes it longer. In a crowded row all blocks narrow together.
- **Tabs move by hand.** Drag a terminal tab or a file tab along its row: it stays under the pointer and the tabs it passes slide out of its way. A file tab dragged onto another editor's stretch joins that editor; dragged down onto an editor it lands against the nearest edge in an editor of its own, or among that editor's files if dropped in its middle. Esc calls it off.
- **Marks.** The tab with the keyboard is lit, and what is on screen beside it is lit more quietly. A terminal's dot pulses while it works. A file with unsaved changes has no dot: its page icon glows and pulses blue until it is saved.
- **Temporary tabs.** A file you open (from the navigator, ⌘O, a link, a search hit) gets a temporary tab, its name slanted. The next file you open in that editor takes its place, so looking through files leaves one tab, not a row of them. Saving the file (⌘S) or a double click on it, in the navigator or on its tab, makes the tab one that stays; a file opened after that gets a new temporary tab. A temporary tab with unsaved typing is never replaced. Notes you make (⌘N, ⌘T, New File), the graph, and several files dropped at once get tabs that stay. "Temporary tabs for opened files" under Settings, Behaviour (`previewTabs`) turns this off. `test/scenarios/temptabs.mjs` checks this; the other scenarios run with it off (`test/drive.mjs`), since they open several files and expect a tab for each.

The Rendered/Raw switch, "Switch displays" and the expand button sit at the top right; Rendered/Raw acts on the editor used last. `test/scenarios/areas.mjs` checks all of this, and `test/scenarios/oldsession.mjs` that a session saved before the two areas were parted opens in the present shape (each tab keeps its terminals, every open file goes to one editor).

An open file reloads by itself when an agent, a command or another program changes it on disk, in raw and rendered views, keeping your place. A file with unsaved typing is left alone, and a notice says it changed underneath you. (The main process watches the folders of open files; `test/scenarios/reload.mjs` checks this.)

Terminals are named for the project folder and the running program: `~/brain2 terminal`, `~/brain2 claude`; file tabs for the file. A long folder keeps its two ends (`~/…/astrolabe`). A tab with a command running has a pulsing neon dot. An agent waiting for your reply does not pulse: Claude Code titles the window with ✳ while it waits and a spinner while it works, and Astrolabe reads that. When an agent's turn ends, or a command finishes, on a tab you are not looking at (another tab, or terminals hidden behind editors that fill the window), that terminal's segment flashes once and keeps a green or red mark until you visit it.

## The graph

⌘G (or "Graph" in the command palette) opens a tab that shows every note in the project as a point and every link between two notes as a line: `[[wiki links]]`, `![[embeds]]` and ordinary `[links](to/a-note.md)`. Linked notes pull together, all notes push apart, and the more a note is linked the larger it is drawn. Notes in dot folders are left out.

A note's colour comes from where it lives: the notes are listed folder by folder and the list is laid along one gradient, green through teal to blue, so notes that sit together are coloured alike and a large project shows its folders as bands of colour. The key at the bottom left names the top folders.

Scroll to zoom and drag to move about; double-click the background to fit everything again. Pointing at a note lights it with the notes it links to and names them; close up, every note is named. Click a note to open it (⌘-click: in a new editor to the side), or drag it to pull it somewhere. Typing in the box picks out the notes whose path matches, and Enter opens the first. A note that is open in an editor wears a ring. The graph reads the notes again a moment after files change, and keeps its arrangement while the window is open. `src/lib/graph.ts` reads the notes and arranges them, `src/components/GraphView.tsx` draws them, and `test/scenarios/graph.mjs` checks it (`REAL=/some/folder` draws that folder too).

## Updating a running copy

⌘R compares the source folder with this copy and does no more than the change calls for.

- **Only the interface changed (`src/`, `index.html`).** It is built straight into the running copy, which takes about a second, and every window reloads where it stands. The shells are the same processes afterwards and whatever they are running keeps running; each terminal's screen, scrollback and blocks, the half-typed command, unsaved edits, carets, scroll positions and the open folders in the navigator are all handed from the old page to the new one (`src/lib/handoff.ts`: `carry` a piece, read it back with `carried`). A picture of the window covers the gap, so nothing blinks. If the new build fails to compile, nothing changes; if it compiles but cannot draw its first screen, the last build is put back.
- **The main process changed (`electron/`).** That is built in place too, and then Astrolabe relaunches, which ends the shells. If any terminal has a command running, it asks first, and offers to reload the window alone (bringing in the interface changes and leaving the rest for later).
- **Electron, node-pty, the app's name or version, or the icon changed.** The whole app is packaged again and swapped in, as `npm run install-app` does.

The shells survive a reload because they belong to the main process, which holds their output while there is no page and then sends it on. `test/scenarios/hotreload.mjs` checks the first case (it only touches a file's timestamp, so it is safe to run in the real folder); `test/scenarios/update.mjs` the second, against a packaged copy.

## Look

- The window is translucent over a blurred desktop, with a fade when Astrolabe gains or loses focus (panes and windows inside the app are never dimmed). Opacity, focused / unfocused: terminal `opacityFocused` 0.95 / `opacityUnfocused` 0.89; tab row `chromeOpacityFocused` 1 / `chromeOpacityUnfocused` 0.94. The editor and the file navigator are solid, focused or not: neither the desktop nor the stars show through them.
- Opening and closing are animated, briefly: new tabs, panes, file tabs and windows fade and slide in; closed ones fade out (170ms) while the panes beside them glide into the space; the file navigator slides out like a drawer. Dragging a divider stays instant, and macOS "Reduce motion" turns it all off. Timings are `--enter`/`--exit` in `styles.css` and `EXIT_MS` in `src/lib/motion.ts`.
- `starfield` draws a faint, grainy scatter of stars behind the terminals and the tab row.
- What you type is semi-bold (`fontWeight`, never below 500); program output keeps its own regular and bold.
- Rendered notes use semibold Literata for headings and SF Pro medium for text. "Choose notes text font", "Choose notes heading font" and "Choose terminal and code font" in the command palette pick any Google Fonts family instead (fetched from Google on first use). Everything else in the interface is monospaced.
- Themes: "Change theme" in the palette. The default, Meridian, is blue on near-black.
- Settings: the gear at the left of the navigator's footer (also "Settings" in the palette) opens Appearance and themes (with the starfield), Fonts, Font sizes (terminal and code, notes text, navigator; reset) and Behaviour (word wrap, smooth caret, reopen last session, scroll speed). Escape steps back a level. Everything is saved to `settings.json`.

## Editing Markdown in rendered view

A click on a link shows a small box under it with the address: click the address to go there, or the pencil to change it (Enter keeps the change, Escape drops it, an emptied address removes the link and keeps its words). ⌘-click still goes straight there. `test/scenarios/linkbox.mjs` checks this.

The two views are two ways of editing the same text, and both can always edit it. They are kept in step block by block: each top-level block of the rendered note is tied to the stretch of the file it was read from. An edit in the rendered view rewrites only the blocks it touched, in the common form (dash bullets, `#` headings, `1.` `2.` `3.`); every other line of the file stays exactly as written, and a block that is only moved keeps its text too. A change made outside (raw view, an agent, another program) redraws only the blocks that changed, so the caret keeps its place. `[[wiki links]]`, `![[embeds]]` and front matter are kept as written.

Markdown the rendered view has no block for (a link definition such as `[ref]: https://…`, say) would lose words if it were written back from there, so that stretch is shown as a dashed "markdown source" block instead: its text as it is in the file, edited as text. Nothing makes a note read-only. (`test/scenarios/bridge.mjs` checks this, and with `PROBE=/some/folder` reports how every note under that folder would be cut up.)

Rendered editing follows the raw view: the same line keys (above), the same pairs (`{` `[` `(` `<` typed before a space or the end of a line bring their closing half, which you type over, and Backspace takes both while the caret is still between them), and a caret that glides and blinks with Monaco's timings (drawn by the app, since the browser's own cannot glide; "Turn smooth caret on or off" applies to both). Moving works on lines as they are in the file: a paragraph passes through a list one item at a time, an item leaves its list past the paragraph above it, a nested item at the edge of its list steps out beside the item it was under, and a code line moves inside its block until the edge, where the block moves. A list item always moves with what is nested under it. `test/scenarios/richkeys.mjs` checks all of this.

Numbered lists count `1.` then `a.` then `i.` as they nest (the file keeps numbers; Markdown has no letters). In the raw view, Tab, Shift+Tab and Enter on a numbered item renumber the list around it, so each level counts on from the item above (`test/scenarios/rawlists.mjs`). A nested item indented less than Markdown asks for (two spaces under `1. `, which Markdown reads as not nested) is shown nested all the same (`test/scenarios/nested.mjs`).

A note's file name shows as a faint title; editing it renames the file. The title keeps to one line: a long name is set smaller until it fits. When the note's first line is short enough to leave room, the title sits larger at the right of that line, on the same baseline; otherwise it sits above the note at the left. `test/scenarios/titleside.mjs` and `notetitle.mjs` check this.

A toggle is kept in the file as `<details>`, `<summary>title</summary>`, its blocks and `</details>`, each set off by a blank line, which GitHub and Obsidian fold the same way; `open` on `<details>` records that it is open, so opening or closing one is an edit to the file. Enter in the title goes inside an open toggle and makes a new toggle below a closed one; Enter in an empty toggle, or Backspace at the start of a title, turns it back into ordinary lines; Enter on an empty last line leaves the toggle. The caret steps past a closed toggle. A title is plain text. `<details>` written any other way stays as the HTML it is. When one editor fills the window (expanded with ⌃⌘F, with no other editor beside it), a note sits in a column in the middle in both views; code files stay at the left.

**Notes change kind.** A bullet, a to-do, a numbered item and a toggle are four kinds of note, and any of them becomes another when that kind's mark and a space are typed where its words begin: `- ` (or `* `), `[] ` (`[x] ` for a ticked one), `1. ` and `> `. One rule says how far the change reaches: the note itself, everything nested under it, and every note after it on its own layer with what is nested under those, as far as the next thing that is not a note (a paragraph, a heading, a rule). What comes before it stays as it was. A note's own mark typed again is just the characters. To-dos keep their ticks while they stay to-dos and start unticked when they become to-dos; a numbered list counts from the number typed, or carries on from a numbered list straight above it; a toggle's title is plain words, so a first line's bold or links are lost when it becomes one. `[]` needs its space, on an ordinary line too. One ⌘Z takes a change back. `test/scenarios/retype.mjs` checks this (`src/lib/richNotion.ts`).

**Traces from the title.** Faint lines run out from a note's title into whatever the note leaves open around it, whether the title has a row to itself or sits beside the first line: along its row, over its top, down the margin where the pane is wider than the text, and down past the ends of short lines under it. They are laid out as the copper on a circuit board is (`src/lib/titleWires.ts`): on a grid, turning only by 45 degrees, leaving the title's letters as the pins of a chip do (each line starts against a letter: the side of the first or last, the top or the foot of the one it is over, so they meet the word at different depths and not along a box around it; the letters are found by drawing the title as the page does, `titleGlyphs` in EditorPane.tsx), running in bundles that make the same turns and stop one after another, ending in vias and pads, and never crossing each other, the title or the text. The text is kept clear line by line (`noteBoxes` in EditorPane.tsx gives each line's box), so the lines differ with the shape of the note: one that meets text turns along it until its way is open again, jogs lean to the side that has room, and the layout is made again as you type. A file's pattern is made from its path, pin by pin, so it is the same every time, different from every other file's, and only the lines the text reaches change. Each line goes from the accent colour through a cooler one to grey along its length, some carry a short lit stretch, there is a soft bloom under them by the word, and everything fades with its distance from the word. `test/scenarios/wires.mjs` checks this.

**Notes sit evenly.** Notes that follow one another on a layer are spaced as the items of one list are, whatever kinds they are, so there is never a wider gap between two bullets than between any others. Two lists of one kind are also never left one straight after the other by an edit (a bullet started just above a list, Enter twice in a list and a new bullet, the line between two lists deleted): they become one list, instead of being written to the file as two with different marks. Lists that were apart when the file was read are left as they are. `test/scenarios/listgaps.mjs` checks this.

**The selection in a rendered note** is drawn, like the caret (`src/lib/richSelection.ts`): a box for each line behind the words, the lines of a paragraph meeting so it reads as one shape, with the corners that stick out rounded by 3px. Inside code the browser's own square highlight stays. `test/scenarios/roundsel.mjs` checks this.

**Enclosing a selection, and the raw view's Markdown.** Anything that encloses a phrase, typed over a selection, goes around it instead of replacing it: `( [ { <`, `"` and `'`, the curly quotes, and the backtick, `*` and `_` (which in a rendered note become code, italic and bold rather than characters). Rendered and raw views do the same. A web address pasted over selected words makes them a link to it, in both views; pasted over another address it replaces it. The raw view is VS Code's editor, with what VS Code's Markdown support adds to it: headings are the file's outline (⇧⌘O) and fold as sections, as fenced blocks do; ⌘-click on a link opens the file or the page; ⌥⌘↑ and ⌥⌘↓ add a caret on the line above or below (they move between panes everywhere else). Three of VS Code's editor keys do something else here and are left as they are: ⌘D splits a terminal, ⌘G opens the graph, ⇧⌘↩ fills the pane. `test/scenarios/rawnice.mjs` and `richkeys.mjs` check this.

**Pictures in notes.** A rendered note shows its pictures, whether the file gives a web address or a path from the note's folder. Drop a picture on a note (from Finder, from the navigator, or dragged out of a browser) and it goes in where you dropped it; paste one (a screenshot on the clipboard) and it goes in at the caret; ⇧⌘A and `/file` work too. Rendered and raw views write the same Markdown, `![name](where)`. A picture from outside the project is copied into `attachments/` beside the note first, so the note's folder holds everything the note shows; one already in the project is pointed to where it is. A picture dragged from the navigator onto a terminal is attached there by its path, like one dropped from Finder.

To have a note carry its pictures wherever its text goes, set `imageUpload` in the settings file (⌘,) to a command that uploads a picture: it is given the file's path as its last argument and must print the picture's web address. Each picture put into a note is then uploaded and the note holds the address; "Upload the pictures in this note" in the palette does the same for pictures already in a note as files (one undo step). With `imageUpload` empty, the default, nothing is sent anywhere. `scripts/upload-image.sh` is such a command for a public Vercel Blob store: it reads the store's read-write token from `~/.astrolabe/blob-token`, and gives a picture an address made from its contents, so the same picture has one address and nobody finds it without being given the address (anyone who is given it can see the picture). An upload that fails leaves the picture as a file. `test/scenarios/images.mjs` checks all of this, with a stand-in uploader (`UPLOAD=1` and a `SETTINGS` that names one).

A task ticks only from a click on its box or ⌘↩ on its line, never from a click in its text. Its box fills in from the middle when ticked and drains back when unticked (140ms; `test/scenarios/tickbox.mjs`). Headings have no underline, so the only horizontal lines are the ones written as `---`; The heading the caret is in shows its `#`s in grey in front of it (the others show only their words), and the six levels run from 1.8em down to 1.25em. The `#`s are text, as in the raw view: the caret runs through them, they can be selected, and typing or deleting one changes the level. A line that no longer reads "`#`s, a space, words" (the space deleted, a seventh `#`) is an ordinary line, and becomes a heading again when it does; selecting a whole heading line and typing replaces its `#`s too. Backspace where a heading's words begin takes one `#` away, so it goes up a level, and the last one leaves an ordinary line; Enter there opens a line above. The `#`s are never written twice: they carry a mark of their own that the file never sees (`src/lib/richHashes.ts`). `test/scenarios/tasks.mjs` and `hashes.mjs` check this.

Text in a rendered note slides rather than jumps when Markdown's own characters come and go (`src/lib/richMotion.ts`, 110ms): a heading's `#`s grow in and out as the caret enters and leaves it, brackets typed around a selection grow in, and the `*` `_` `` ` `` `~` typed around words shrink away as the words turn bold, italic, code or struck through. The caret keeps up with the moving text. `test/scenarios/slide.mjs` checks this. The raw view does not slide: Monaco lays its text out itself.

⌘X with nothing selected cuts the line the caret is on: a list item goes with anything nested under it, and a list or quote left empty goes too. The clipboard gets the line as Markdown. Pasting it back into a rendered note puts it in as a whole line above the caret's line: onto a bullet it becomes a bullet there, and onto a paragraph a cut bullet becomes a list of its own (or rejoins the list just above). An empty line is removed without changing the clipboard. `test/scenarios/cutline.mjs` checks this.

## Testing

`node test/drive.mjs <scenario>` launches the built app against a throwaway config folder and saves screenshots (`SHOTS=/some/dir`; `APP=/path/to/binary` tests an installed build; `SETTINGS='{"prompt":"astrolabe"}'` sets settings; `STATE='{"session":…}'` starts from a saved session). Scenarios are in `test/scenarios/`.

## Not built yet

Agent and other external integrations, notifications, code signing, find in the rendered Markdown view, an emoji popup in the rendered view (shortcodes still convert there), and a smooth cursor inside running programs.
