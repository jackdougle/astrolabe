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
| ⌘D / ⇧⌘D | Split right / down (always a plain terminal) |
| ⌘T | New terminal tab; in the editor, a new `Untitled.md` beside the open file |
| ⇧⌘T | New terminal tab from anywhere |
| ⌘N | New note at the top of this project (the terminal's git repo, else its folder), starting with `*11.11.2026 - 2520 Milvia St*` from CoreLocationCLI (`???` if the street can't be found). Closed with nothing added, the note is deleted again; one you typed in and saved, or gave a name, is kept. ⇧⌘N is a new window |
| ⌘1–9, ⌃Tab | Switch tabs (the tab row runs along the top of the window; terminals and open files are both tabs in it, counted left to right) |
| ⌘W / ⇧⌘W | Close the file or terminal pane you are in (asks first if the file has unsaved changes; the window closes only when it was the last thing open) / close the tab you are in: the file, or all of that tab's terminals (their files stay open) |
| ⌥⌘arrows, ⌘[ ⌘] | Move between panes |
| ⌃` | Switch between the editor and the terminal (back to the terminal you used last) |
| ⇧⌘↩ | Maximize or restore the pane |
| ⌃⌘F or Fn+F | With terminals and a file side by side: the side you are in fills the tab. Pressed again: the other side comes back beside it. A terminal with no file yet gets an empty `Untitled.md` beside it (deleted again if closed with nothing typed); a file with no terminal gets a new terminal, in the folder its last terminal was in. Also the expand button at the top right |
| ⌃⌘S, ⌃⌘← / ⌃⌘→ | Switch displays (swap the editor and terminals), or put the editor left or right of them (the switch button also toggles; `editorSide` in settings remembers it) |
| ⌘B | File navigator (right-click anywhere for New File, which goes inside the folder you clicked, beside the file you clicked, or at the top of the project; right-click an entry to rename it, move it to the Trash, or reveal it in Finder; ⌘-click adds or drops a row from the selection and ⇧-click takes a run of rows, and right-clicking one of several selected rows moves them all to the Trash) |
| ⇧⌘F, ⌘P, ⇧⌘P | Search in project, open file by name, command palette |
| ⇧⌘A, or type `/file` | Attach files from Finder (dropping files on a pane does the same) |
| ⌘K, ⌘F | Clear terminal, find in terminal |
| ⌘↑ / ⌘↓, ⇧⌘C | Select blocks, copy a block's output |
| Tab or →, ↑ or ⌃P, ⌃R | Accept the grey suggestion (there is no completion menu), previous command, search history |
| ⌃W, ⌃U, ⌃C, ⌃A, ⌃E, ⌃K | The usual line-editing keys in the command input |
| `:` | Emoji suggestions; a finished `:sob:` becomes 😭 |
| ⌘R (also ⌘E, ⇧⌘V) | Markdown: rendered or raw (both editable) |
| ⌘R outside the editor | If the source folder has changed since this copy was built: rebuild, install over this copy and relaunch |
| ⌥Z | Word wrap |
| ⌥↑ / ⌥↓, ⇧⌥↑ / ⇧⌥↓ | Move the line (or the selected lines) up or down; copy it above or below. Raw and rendered |
| ⇧⌘K, ⌘L, ⌘↩ | Delete the line; select it (again takes the next one too); new line below. Raw and rendered |
| ⌘] / ⌘[, Tab / ⇧Tab | Indent or outdent a list item. Raw and rendered |
| `(` `[` `` ` `` `*` `_` `~` over a selection | Go around it instead of replacing it. Raw and rendered (there `*` is italic, `**` bold, `~` struck through, `` ` `` code) |
| ⌘↩ on a task's line | Tick or untick it (raw and rendered) |
| `[]`, `> `, `" ` opening a line (rendered) | A to-do (a bullet becomes one), a toggle, a quote, as in Notion |
| `--`, `->`, `-->`, `<-`, `<--`, `<->`, `<-->`, `=>`, `==>`, `<==`, `<=>`, `<==>` (rendered) | Become — → ⟶ ← ⟵ ↔ ⟷ ⇒ ⟹ ⟸ ⇔ ⟺ as typed, outside code; Backspace straight after puts back what was typed. `---` opening a line still draws a line |
| ⌘↩ in a toggle's title, or a click on its arrow | Open or close it |
| ⌘X or ⌘C with nothing selected | Cut or copy the line (editor only); in a rendered note, the paragraph, heading, list item or code line |
| ⌘-click | Open a file path or link from terminal output (`path:12`, `#L12` and Claude Code's `file://` links open at the line), or a file link in a rendered note; a link broken over several rows opens from any piece |

Hovering a button shows its name and shortcut. Right-clicking a file's tab offers "New File", which makes an `Untitled.md` beside that file (the same as ⌘T).

Terminals and open files are tabs at the same level, in the one row along the top. A file opened from a terminal shows beside it, and its tab is joined to that terminal's tab in one block; blocks stand apart from each other. In a block, the tab with the keyboard is lit and the one showing beside it is lit more quietly. Clicking a tab brings it to the front: side by side if that block is split, alone if one side fills the tab. The Rendered/Raw switch, "Switch displays" and the expand button sit at the top right and act on the tab in front. Dragging a tab onto another block moves its whole block; dragging a file onto a file in its own block reorders them. `test/scenarios/tabrow.mjs` checks all of this.

An open file reloads by itself when an agent, a command or another program changes it on disk, in raw and rendered views, keeping your place. A file with unsaved typing is left alone, and a notice says it changed underneath you. (The main process watches the folders of open files; `test/scenarios/reload.mjs` checks this.)

Terminal tabs are named for the project folder and the running program: `~/brain2 terminal`, `~/brain2 claude`; file tabs for the file. A long folder keeps its two ends (`~/…/astrolabe`). A tab with a command running has a pulsing neon dot. An agent waiting for your reply does not pulse: Claude Code titles the window with ✳ while it waits and a spinner while it works, and Astrolabe reads that. When an agent's turn ends, or a command finishes, on a tab you are not looking at (another tab, or terminals hidden behind a file that fills the tab), the tab flashes once and keeps a green or red mark until you visit it.

## Look

- The window is translucent over a blurred desktop, with a fade when Astrolabe gains or loses focus (panes and windows inside the app are never dimmed). Opacity, focused / unfocused: terminal `opacityFocused` 0.95 / `opacityUnfocused` 0.89; editor `editorOpacityFocused` 0.975 / `editorOpacityUnfocused` 0.915; tab row and file navigator `chromeOpacityFocused` 1 / `chromeOpacityUnfocused` 0.94.
- Opening and closing are animated, briefly: new tabs, panes, file tabs and windows fade and slide in; closed ones fade out (170ms) while the panes beside them glide into the space; the file navigator slides out like a drawer. Dragging a divider stays instant, and macOS "Reduce motion" turns it all off. Timings are `--enter`/`--exit` in `styles.css` and `EXIT_MS` in `src/lib/motion.ts`.
- `starfield` draws a faint, grainy scatter of stars behind everything.
- What you type is semi-bold (`fontWeight`, never below 500); program output keeps its own regular and bold.
- Rendered notes use semibold Literata for headings and SF Pro medium for text. "Choose notes text font", "Choose notes heading font" and "Choose terminal and code font" in the command palette pick any Google Fonts family instead (fetched from Google on first use). Everything else in the interface is monospaced.
- Themes: "Change theme" in the palette. The default, Meridian, is blue on near-black.
- Settings: the gear at the left of the navigator's footer (also "Settings" in the palette) opens Appearance and themes (with the starfield), Fonts, Font sizes (terminal and code, notes text, navigator; reset) and Behaviour (word wrap, smooth caret, reopen last session, scroll speed). Escape steps back a level. Everything is saved to `settings.json`.

## Editing Markdown in rendered view

The two views are two ways of editing the same text, and both can always edit it. They are kept in step block by block: each top-level block of the rendered note is tied to the stretch of the file it was read from. An edit in the rendered view rewrites only the blocks it touched, in the common form (dash bullets, `#` headings, `1.` `2.` `3.`); every other line of the file stays exactly as written, and a block that is only moved keeps its text too. A change made outside (raw view, an agent, another program) redraws only the blocks that changed, so the caret keeps its place. `[[wiki links]]`, `![[embeds]]` and front matter are kept as written.

Markdown the rendered view has no block for (a link definition such as `[ref]: https://…`, say) would lose words if it were written back from there, so that stretch is shown as a dashed "markdown source" block instead: its text as it is in the file, edited as text. Nothing makes a note read-only. (`test/scenarios/bridge.mjs` checks this, and with `PROBE=/some/folder` reports how every note under that folder would be cut up.)

Rendered editing follows the raw view: the same line keys (above), the same pairs (`{` `[` `(` `<` typed before a space or the end of a line bring their closing half, which you type over, and Backspace takes both while the caret is still between them), and a caret that glides and blinks with Monaco's timings (drawn by the app, since the browser's own cannot glide; "Turn smooth caret on or off" applies to both). Moving works on lines as they are in the file: a paragraph passes through a list one item at a time, an item leaves its list past the paragraph above it, a nested item at the edge of its list steps out beside the item it was under, and a code line moves inside its block until the edge, where the block moves. A list item always moves with what is nested under it. `test/scenarios/richkeys.mjs` checks all of this.

Numbered lists count `1.` then `a.` then `i.` as they nest (the file keeps numbers; Markdown has no letters). In the raw view, Tab, Shift+Tab and Enter on a numbered item renumber the list around it, so each level counts on from the item above (`test/scenarios/rawlists.mjs`). A nested item indented less than Markdown asks for (two spaces under `1. `, which Markdown reads as not nested) is shown nested all the same (`test/scenarios/nested.mjs`).

A note's file name shows as a faint title; editing it renames the file. When the note's first line is short enough to leave room, the title sits larger at the right of that line, on the same baseline; otherwise it sits above the note at the left. `test/scenarios/titleside.mjs` and `notetitle.mjs` check this.

A toggle is kept in the file as `<details>`, `<summary>title</summary>`, its blocks and `</details>`, each set off by a blank line, which GitHub and Obsidian fold the same way; `open` on `<details>` records that it is open, so opening or closing one is an edit to the file. Enter in the title goes inside an open toggle and makes a new toggle below a closed one; Enter in an empty toggle, or Backspace at the start of a title, turns it back into ordinary lines; Enter on an empty last line leaves the toggle. The caret steps past a closed toggle. A title is plain text. `<details>` written any other way stays as the HTML it is. When the editor fills the tab (expanded, or alone in it), a note sits in a column in the middle in both views; code files stay at the left.

A task ticks only from a click on its box or ⌘↩ on its line, never from a click in its text. Its box fills in from the middle when ticked and drains back when unticked (140ms; `test/scenarios/tickbox.mjs`). Headings have no underline, so the only horizontal lines are the ones written as `---`; Backspace in a heading with no text left makes it an ordinary line. `test/scenarios/tasks.mjs` checks this.

⌘X with nothing selected cuts the line the caret is on: a list item goes with anything nested under it, and a list or quote left empty goes too. The clipboard gets the line as Markdown. Pasting it back into a rendered note puts it in as a whole line above the caret's line: onto a bullet it becomes a bullet there, and onto a paragraph a cut bullet becomes a list of its own (or rejoins the list just above). An empty line is removed without changing the clipboard. `test/scenarios/cutline.mjs` checks this.

## Testing

`node test/drive.mjs <scenario>` launches the built app against a throwaway config folder and saves screenshots (`SHOTS=/some/dir`; `APP=/path/to/binary` tests an installed build; `SETTINGS='{"prompt":"astrolabe"}'` sets settings). Scenarios are in `test/scenarios/`.

## Not built yet

Agent and other external integrations, notifications, code signing, find in the rendered Markdown view, an emoji popup in the rendered view (shortcodes still convert there), and a smooth cursor inside running programs.
