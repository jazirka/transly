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

## How a translation moves

A row is **Без перекладу** (nothing yet), **Чернетка** (something is written), **Надіслано** (the translator sent it) or **Вичитано** (a second pair of eyes approved it). The paper plane **sends**, the tick **approves** (a draft is sent and approved in one step); a sent row can be **returned for rework**. There is no separate review mode: approving lives in the right panel and in the bulk bar. Only a QA *error* (a broken control code, a missing glossary term that is enforced…) is red; advice such as the length of a line is a neutral hint and never blocks anything.

Every bulk action (send, approve, fill from memory, wrap, clear, send a scene or a group) is one entry of the journal, and its message carries **Скасувати**. The same entry can be taken back later from Activity, and **Ctrl+Z / Ctrl+Shift+Z** outside a text field take back and repeat the last bulk actions of the session (rows changed since are never touched).

## The workspace (desktop)

- **Centre:** *Таблиця* | *Редагування* | *Сцена*. The table edits a translation in its cell (F2 or a double click; Enter and Tab save and go to the next row, Shift+Enter writes a line break). The editor works on one row. The scene mode shows every line of the event page the row belongs to, one after another as in the game, and each line is translated in place (Ctrl+Enter sends and moves to the next card); «Як у грі» opens the message-window preview.
- **Right panel (one, like Crowdin):** the translation of the row with who wrote it and when and the earlier versions (restore, compare); automatic proposals (translation memory with the match percent, rows with the same original); the terms of the row and the names the game defines (a click opens the card); the discussion. It follows the selected row in every mode.
- **A narrow window** (up to ~1180 px): the left panel gets narrower, the right panel is folded by itself (until you open or close it by hand) and, when opened, lies over the centre; the table drops the speaker column and then moves the key under the original, so the translation column is always there. The bulk bar lies over the header of the table instead of pushing the rows down.
- **Left panel:** files (with **groups of files** as folders of your own: Ctrl+click files → «У групу…», the context menu, or drag; a click on a group opens its files as one table), rows, glossary, scenes.
- **Words in the text:** glossary terms are underlined in the original and in the translation, with arrows to their counterpart and a card; control codes are underlined too.
- **Names:** a file is called the same everywhere: «Ліс · Map002» (the game's label and the file without `.json`), or «Items»; tabs show the short form. **Ctrl+K** groups its results (files, rows with the original, the translation under it and where it is, terms).
- **Keyboard:** the menu bar (←/→, ↓, Esc), popovers (↑/↓), the file tree (one tab stop, arrows, → and ← fold folders, Enter opens, Space ticks), focus returns to where it was after a dialog or the search closes; Ctrl+K or two ⇧ outside a text field open the search; F5 runs the chosen build.

## Sync between devices (no cloud service)

Run the relay on a machine you control (a PC on your network, a VPS, behind a tunnel):

```
node server/relay.ts --port 7421 [--dir ./relay-data]
```

Then on every device: Settings → Synchronization → server address and the same passphrase.
Data is encrypted on the devices (AES-GCM, key from the passphrase); the relay only holds opaque blobs and forgets them after 30 days.
Edits are merged per string, the newer edit wins, and concurrent edits to the same string are reported.
For addresses reachable over the internet use https (browsers block plain http from https pages).

### Sync through the artifact itself (no file picker, no server)

When the app runs as a Claude artifact, its shared database (`db` capability) is reachable from every device that opens the same artifact. Settings → Synchronization via Claude pushes the project; on the other device (a phone, where the artifact view cannot open a file chooser) the start screen and the "Open files" dialog offer **Get from another device**. Files are gzipped, base64-encoded and split into content-addressed chunks of at most 180 KB (a document may hold 256 KiB); chunks are written before the index, and the index changes under a short lease, so a reader never sees half a file and two devices do not overwrite each other. Same merge as the other syncs. The section appears only inside an artifact.

### Sync through your own GitHub repository

Settings → Synchronization via GitHub. Create a repository (private is best) that has at least one file (a README), and a fine-grained token limited to that repository with **Contents: Read and write**. Enter `owner/name` and the token; the token stays in this browser only.

The project is stored as plain files, so the commit history shows what changed and when:

```
project.json                   glossary, memory, speakers, settings
translations/<file>.tr.json    one file per game file: key → translation, status, comments, history
originals/snapshot.json.gz     the game's original strings (so a phone without the game can show them)
originals/reference.json.gz    reference-language texts
```

Each sync downloads only the files that changed, merges them per string (the newer edit wins), and pushes the result as one commit. The originals are pushed only to a **private** repository (never to a public one) and only when their revision changed. A branch that does not exist is created from the default branch; an optional folder keeps several projects in one repository. Browsers allow requests to `api.github.com` from a normal page; an embedded preview that blocks outgoing requests cannot sync. For GitHub Enterprise set the API address under "Додатково".

Settings follow the newest deliberate change (a new device's defaults never replace chosen settings).

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
- Settings → Reference languages: pick the same game in another language (as many as you like: add RU, PL…, each with its own code); each is aligned line by line (even when that version added or removed lines) and shown under the original. A Russian copy of Fear & Hunger 2 aligned 99.97% of the rows.

## RPG Maker extras

- **Plugin command texts** (Tools → Plugin texts, offered once after the game is opened): some games show text through plugin commands (`GabText …`, `choice_text 1 …`) instead of message boxes. The game's own commands are listed with samples; the ones ticked become extra rows (`plugin[N]`). The command name and numeric arguments are kept when the translation is written back.
- **Speakers**: MV stores no speaker names, so a speaker is taken from the game when it has one, otherwise from a name printed as the first line of the message (`\>\i[73]\}ANITOR\{\<` shows JANITOR: the icon is the first letter, found automatically for icons 64–88; the translator can rename it once), otherwise from what the translator names once: the message's face graphic, the developer's own label in a comment right before the text (`MARCOH`), or the event. Tools → Define speakers.
- **Location**: maps are labelled with their `displayName` or the name from `MapInfos.json` (shown in the file tree and in the row's details).
- **Names from the game**: when a line mentions an item, skill, character or enemy from the database, the glossary hints show how that name is translated there (click to insert it).
- **Line width**: Settings → line width (by default taken from the original's own line lengths; narrower when a face picture is shown). Too wide a line is a QA warning, and "Wrap lines" re-flows one row (or Tools → Wrap long lines for the whole file). The length of a translation is never capped.

## Glossary matching by language

Words are told apart by script. **English** (the term and the source text): plurals and verb forms (`skills`, `boxes`, `bodies`, `knives`, `making`), possessives, and British/American spelling (`armour`/`armor`, `defence`/`defense`, `colour`, `grey`, `travelled`, `-ise`/`-ize`); whole words only, phrases across spaces and hyphens, control codes ignored. **Ukrainian** (the translation): every word by its stem, so any case, number and the usual alternations match (`меч` ~ `мечем`/`мечів`, `нога` ~ `нозі`, `рука` ~ `руці`, `кінь` ~ `коня`, `навичка` ~ `навичок`). Terms are looked up through an index of their first word, so a dictionary of thousands stays fast.

## Updating the Android and desktop apps

Both apps can find and install a new build from the releases of the private repository (`android-latest`, `desktop-latest`), using a read-only token the user enters under Settings → "Оновлення застосунку" (fine-grained token, repository `jazirka/transly`, **Contents: Read-only**; it stays on the device). At start (and on demand) the app compares the commit it was built from (`__BUILD_ID__`, set from `GITHUB_SHA` by the CI) with the release's commit. If they differ: "Є нова версія" → "Завантажити й встановити". **Android** downloads the APK into Downloads (the redirect to the file store is followed without the token) and opens the system installer (the app must be allowed to install apps once). **Windows** downloads the installer into a temp folder, starts it and closes the app (only a release asset of `api.github.com`, only `.exe`/`.msi`). macOS and Linux show the release page. A version the user declined is not offered again. Local builds are marked `dev` and never offer anything.

## Scene preview and playing a scene in the game

- **Scene preview** («Як у грі» in the scene mode, or Navigation → View scene): all rows of the event page the current row belongs to, one after another, as message windows. Speakers, choices grouped under their question, `\C[n]` colours, `\N[n]` replaced by the actor's name from `Actors.json` (when the file is open), other codes as small chips, lines wider than the game window marked. Show the translation, the original or both; click a row to pick it. Works on the phone too (it uses only the project's rows).
- **Play in the game** (desktop app, RPG Maker MV/MZ): from the preview, "▶ From the chosen line" or "▶ From the start of the event". The app writes the translation (drafts too) into the game, adds a small plugin `js/plugins/TranslyJump.js` plus one entry at the end of `js/plugins.js`, and starts the game: it skips the title, puts the player on the event's tile (or loads the chosen save) and runs the event page from the chosen command. `js/plugins.js` is backed up once as `plugins.js.transly-orig`; Build → "Повернути оригінали" (or any normal "Apply") removes the plugin again. Battle rows start that troop's fight and run the chosen event page; database rows are not offered. Scenes can depend on the game's state (switches, variables, party), so pick a save for those.
- The plugin's logic is tested against stand-ins for the engine's objects (`test/scene.test.ts`); it has not been run in a real RPG Maker game from here.

## More context for translators

- **Control codes explained** in the hints: `\N[1]` → the actor's name, `\V[12]` → the variable's name from `System.json`, `\G` → the currency, colours, pauses.
- **Event conditions** in the row's details and in the scene preview: trigger, tile, switches (with their names), variable, self-switch.
- **Database notes**: the `note` field of items/skills and where the game hands them out (needs the game's files).
- **Scene preview** also has a game-window mode (816 px, 28 px font, width measured in pixels) and "send the whole scene"; the scene mode itself can also approve the whole scene.
- Tools → **Find and replace** (previews every change, you tick what to change) and **Check consistency** (the same original translated in different ways; pick the variant to apply everywhere).

## Moving work between devices by file

Settings → Exchange project through a file saves everything but the game files into one `.transly.json`. On a phone (no folder picker) use **Open files or paste JSON**: pick that file, paste its text, or pick game files (`.json`, `.po`, `.csv`, `.rpy`) directly. Imports merge row by row; the newer edit wins.

## Android app

`android/` is a small Android project that wraps the web app in a WebView, so the phone gets what a browser tab or an artifact view cannot give: the system **file chooser**, **saving to Downloads**, working **offline**, requests to GitHub / your sync server, and two **home-screen widgets** in One UI's frosted-glass pill style: a progress pill (ring with the approved share, translated share behind it, approved/total numbers) and a "next line" pill (the next untranslated row; a tap opens it in the editor).

- The app's files are copied into the APK and served from a fixed https origin, so storage and `crypto` behave as on the web. The page talks to the app through `window.TranslyAndroid` (`src/ui/android.ts`): progress numbers for the widget, saving files in pieces, and the back button (closes dialogs and panels first).
- Build: the GitHub Actions workflow **Android APK** builds it with the official Android SDK and uploads `transly.apk` as an artifact (Actions → the run → Artifacts). The APK is signed with the debug key, so install it by hand (allow installs from this source) and publish with your own key if you ever distribute it.
- Locally, with the Android SDK: `npm run build`, copy `dist/*` into `android/app/src/main/assets/`, then `cd android && ./gradlew assembleRelease`.
- Android 10 or newer.

## Two apps: desktop and phone

The desktop app (`src/main.ts` → `src/ui`, packaged by Tauri) and the phone app (`src/main-mobile.ts` → `src/mobile`, packaged into the APK) are separate: each has its own shell, styles and screens. They share only `src/core` (formats, QA, merging, sync) and a few storage/sync helpers (`ui/idb`, `ui/github`, `ui/claude`, `ui/android`, `ui/markup`).

- `npm run build` → `dist` (desktop, unchanged); `npm run build:mobile` → `dist-mobile` (phone, used by `.github/workflows/android.yml`).
- `npm run dev` / `npm run dev:mobile` start the two dev servers.
- The phone app: Файли → Рядки → Переклад → Ще, bottom navigation, swipe between rows, bottom sheet with glossary/memory/comments/history, **groups of files** (select files → «У групу»), a scene screen where the picked line is translated in a field on the spot, the same ✓ approve and paper-plane send as on the desktop, bulk send/clear with «Скасувати», GitHub/Claude sync and in-app updates in «Ще».
- `UIUX-REVIEW.md` keeps the last UI/UX review and the waves that follow from it.
