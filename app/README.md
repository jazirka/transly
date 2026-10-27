# Transly app

Real application, built from the design in `../mockup`.

- `src/core` — pure TypeScript, no DOM: RPG Maker import/export, QA, workflow, project merge, autosave. Covered by tests.
- `src/ui` — browser UI (vanilla TS + Vite). Folder access via File System Access API with an `<input webkitdirectory>` fallback; project stored in IndexedDB.

```
npm install
npm run dev        # dev server
npm test           # unit tests
GAME_DATA_DIR=/path/to/game/data npm test   # also run round-trip checks on real game files
npm run build      # typecheck + production build
```

Game files are only read, never modified. Translations live in the browser profile.

## Sync between devices (no cloud service)

Run the relay on a machine you control (a PC on your network, a VPS, behind a tunnel):

```
node server/relay.ts --port 7421 [--dir ./relay-data]
```

Then on every device: Settings → Synchronization → server address and the same passphrase.
Data is encrypted on the devices (AES-GCM, key from the passphrase); the relay only holds opaque blobs and forgets them after 30 days.
Edits are merged per string, the newer edit wins, and concurrent edits to the same string are reported.
For addresses reachable over the internet use https (browsers block plain http from https pages).

## Desktop app (Tauri)

The same UI runs in a Tauri shell that adds what a browser cannot do: remember the game folder, write the translation straight into the game's `data` folder (originals are backed up once next to it, in `data.transly-orig`, and can be restored), and launch the game for testing.

```
npm run tauri dev      # run the desktop app
npm run tauri build    # installer for the current OS
```

Linux needs `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`. The UI can only touch folders and the game executable picked in a native dialog; paths are checked in `src-tauri/src/lib.rs`.

## Supported formats

| Format | Files | Notes |
| --- | --- | --- |
| RPG Maker MV/MZ | `data/*.json` | dialogue, choices, scroll text, database names/descriptions, `System.json` terms; optionally text of plugin commands (see below) |
| gettext | `.po`, `.pot` | context and plurals; comments, header and obsolete entries are kept |
| CSV/TSV | `.csv`, `.tsv` | columns `key`, `source`/`text`, `translation` (added when missing) |
| Locale JSON | `en.json`, `strings.json`, `locales/*.json`… | nested strings, written back by path |
| Ren’Py | `.rpy` | dialogue and menu choices; code, `$` lines and `python:` blocks are skipped |

Control-code QA (`\C[2]`, `\V[1]`…) currently knows RPG Maker codes only; placeholders of other formats (`[name]`, `{i}`, `%s`) are not checked yet.

## Glossary and reference language

- Settings → Import glossary: a Google Sheets table saved as a web page (`.html`), or `.csv`/`.tsv`, with columns «Оригінал», «Переклад 1…», «Опис», «Розділ». A big dictionary is added as hints only; tick the box to enforce terms in QA.
- Settings → Reference language: pick the same game in another language; its text is aligned line by line (even when that version added or removed lines) and shown under the original.

## RPG Maker extras

- **Plugin command texts** (Tools → Plugin texts, offered once after the game is opened): some games show text through plugin commands (`GabText …`, `choice_text 1 …`) instead of message boxes. The game's own commands are listed with samples; the ones ticked become extra rows (`plugin[N]`). The command name and numeric arguments are kept when the translation is written back.
- **Speakers**: MV stores no speaker names, so a speaker is taken from the game when it has one, otherwise from what the translator names once: the message's face graphic, the developer's own label in a comment right before the text (`MARCOH`), or the event. Tools → Define speakers.
- **Location**: maps are labelled with their `displayName` or the name from `MapInfos.json` (shown in the file tree and in the row's details).
- **Names from the game**: when a line mentions an item, skill, character or enemy from the database, the glossary hints show how that name is translated there (click to insert it).
- **Line width**: Settings → line width (by default taken from the original's own line lengths; narrower when a face picture is shown). Too wide a line is a QA warning, and "Wrap lines" re-flows one row (or Tools → Wrap long lines for the whole file). The length of a translation is never capped.

## Moving work between devices by file

Settings → Exchange project through a file saves everything but the game files into one `.transly.json`. On a phone (no folder picker) use **Open files or paste JSON**: pick that file, paste its text, or pick game files (`.json`, `.po`, `.csv`, `.rpy`) directly. Imports merge row by row; the newer edit wins.
