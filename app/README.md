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

Every action that changes rows (send, approve, fill from memory, wrap, QA fix, find and replace, a game update that lines the translations up with the new version or sends rows back to drafts, clear, send a scene or a group, and also a single send) is one entry of the journal, and its message carries **Скасувати**. The same entry can be taken back later from Activity, and **Ctrl+Z / Ctrl+Shift+Z** outside a text field take back and repeat the last actions of the session and name them («Скасовано «надіслано»: 1 рядок»); rows changed since are never touched. Bulk tools (find and replace, the QA fix, update by the glossary, wrapping, the fill of equal originals) **leave proofread rows alone**: the preview and the message say how many were left out, and find and replace has a switch «Змінити й вичитані» (they then fall back to drafts).

**Drafts the program wrote** (from an identical original, the memory, the words) are marked: a dashed ring instead of the full dot, the «Авто» filter, the «авто» chip in the row. A bulk «Вичитати» says how many of the rows were such drafts. **Ctrl+Z** outside a text field walks back along the whole journal, also over actions of earlier sessions.

**A new version of the game** is lined up with the old one by the text of the originals (`core/ingest.ts`, a shortest edit script per file; the order is kept): a message put in or taken out does not shift the translations onto their neighbours. Translations of lines that are gone are *parked* under a key no row has and come back if the same original appears again; the toast says «перенесено · нових рядків · зникло» and opens a report with **Скасувати зіставлення** (a journal entry of kind `rekey`). Files that differ by more than 600 lines are left as they were. A line whose text was edited in place keeps its translation and goes back to draft as before.

**Progress** has one definition everywhere (file tree, top bar, status bar, groups, scenes, the phone, the widget): a row is *without text*, a *draft*, *sent (not proofread yet)* or *proofread*; «Перекладено» is everything with text; percentages are rounded down and never show 100 until the work is complete. **Going to the next row that waits** works over the whole project: Alt+Shift+↓/↑ — without translation, F8 / Shift+F8 — QA error, Ctrl+Shift+Enter — proofread and on to the next row waiting for proofreading (the «Перехід» menu has the rest; the phone has a button in the editor). The status bar always shows the age of the **newest copy outside the browser** (a project file or a sync; red when there is none or it is a day old) and the last build; the build dialog lists what is not ready in the whole project.

## The workspace (desktop)

- **Centre:** *Таблиця* | *Редагування* | *Сцена*. The table edits a translation in its cell (F2 or a double click; Enter and Tab save and go to the next row, Shift+Enter writes a line break). The editor works on one row. The scene mode shows every line of the event page the row belongs to, one after another as in the game, and each line is translated in place (Ctrl+Enter sends and moves to the next card); «Як у грі» opens the message-window preview.
- **Right panel (one, like Crowdin):** the translation of the row with who wrote it and when and the earlier versions (restore, compare); automatic proposals (translation memory with the match percent, rows with the same original); the terms of the row and the names the game defines (a click opens the card); the discussion. It follows the selected row in every mode.
- **A narrow window** (up to ~1180 px): the left panel gets narrower, the right panel is folded by itself (until you open or close it by hand) and, when opened, lies over the centre; the table drops the speaker column and then moves the key under the original, so the translation column is always there. The bulk bar lies over the header of the table instead of pushing the rows down.
- **Left panel:** files (with **groups of files** as folders of your own: Ctrl+click files → «У групу…», the context menu, or drag; a click on a group opens its files as one table), rows, glossary, scenes.
- **Words in the text:** glossary terms are underlined in the original and in the translation, with arrows to their counterpart and a card; control codes are underlined too.
- **Names:** a file is called the same everywhere: «Ліс · Map002» (the game's label and the file without `.json`), or «Items»; tabs show the short form. **Ctrl+K** groups its results (files, rows with the original, the translation under it and where it is, terms).
- **States and the accent colour (like tool windows in an IDE):** the accent goes to where you are working. The *working window* is the panel of your last click or focus (left, centre or right; a dialog or a lost app focus lights nothing). What is chosen in it (the file in the tree, the open tab, the row, the filter chip, its rail button) wears the colour of the project; the same choice in a window you are not working in is grey (a fill and a ring), and a hovered control is the faintest grey. In menus and popovers the item under the cursor or the keyboard is the choice and wears the colour. There are no bars or underlines; keyboard focus is an outline of the accent. The accent colour comes from the name of the project (one hue, cool colours only, so it is never mistaken for a status), or you pick it in *Налаштування → Колір акценту* (a slider or six ready colours; «Взяти з назви проєкту» undoes the choice); it is saved with the project. Draft, sent, proofread and error keep their own colours (a dot on the rows, the editor and the filter chips). `core/theme.ts` holds the tokens, `ui/activepane.ts` follows the working window and `ui/states.css` is the one place of the states (the phone keeps its own simpler states).
- **Settings (like the settings of an IDE):** a tree of pages on the left (a search over every page, groups that fold: Проєкт, Пов’язане й пам’ять, Перевірка, Синхронізація, Застосунок), the page on the right with breadcrumbs, and «Зберегти / Застосувати / Скасувати» below. What is typed waits until it is applied («Застосувати» is off until something changes and the footer says «Є незастосовані зміни»; the first Esc with a change waiting only says so, the second one throws it away); the accent colour is the exception that can be tried: it changes the whole app at once and goes back on «Скасувати». The buttons that do something (imports, saving to a file, reset, syncing, checking for an update) act at once. Warnings are banners (yellow; the reset of the project is red). Every way of syncing (Claude, GitHub, own server, file) is a page of the tree. The dialog is one size on every page; its frame is the lighter surface and the tree and the page are the darker working areas (`ui/settings.ts`, the `.st-*` rules of `ui/theme.css`).
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
- **Line wrapping** (Tools → Перенесення рядків…; on the phone Tools → Перенос): the game's message window does not wrap lines itself, so this tool decides who does and how. Everything is applied as it changes and kept in the project (it syncs with the settings).
  - *When*: **at build and run** (default; the text in the project stays without line breaks, the build wraps each dialogue and scrolling text of an RPG Maker game in a copy, never in the project), **in the text** (breaks are put in when a row is sent, and the translation memory and the search read the text as one flow), or **off** (only a warning).
  - *Width*: in characters (default, the same everywhere; taken from the original's own lines unless set, 80% when a face picture is shown) or in pixels of the game window (816 px, 28 px font, measured in the browser: approximate, the game's font is not known).
  - *Hyphenation*: words may be broken by syllables with a hyphen (Ukrainian rules built in, no tables; agrees with the TeX hyph-uk patterns on about 97% of breaks): never, **only when needed** (default: the word is longer than a line, or the line would stay too empty), or whenever it fills the line better. The hyphen and the fewest letters before and after it are set there too. Words with Latin letters, digits, control codes inside, or their own hyphen are never broken; `\C[2]word\C[0]` is broken with its codes kept at the ends.
  - *Your own breaks* are kept unless a line is too wide (or always re-flowed, if chosen). A message with more lines than the window shows (4 by default, 0 turns it off) only gets a warning, since the game pages it; nothing is cut. The example in the tool shows how the window will show a text, with a ruler per line.
  - The width setting that used to be in Settings is here now; the QA advice "line too wide" appears only in the modes *in the text* and *off* (in *at build* the build wraps), while "N lines, the window shows 4" appears in all of them.

## QA rules about the form of a translation

Tools → Правила QA… (also a button in Settings; on the phone Tools → Правила QA). The checks on the *form* of the text come as a registry of rules, each with a stable id (the id is what «Ignore» stores for a row, so ids never change) and a level the project chooses: **off**, **advice** (the default: it shows under the field and in the row list, can be mended with one click, and blocks nothing) or **error** (the row cannot be sent or built until it is mended). Only damaged control codes are an error by default. Old projects have no choices stored and so block nothing new; the choices live in the project settings (`qa`) and sync with them.

- `code-malformed` (error): a Cyrillic letter instead of a Latin one in `\C[2]`, a space inside the code (`\C [2]`, `\ C[2]`), a missing `]`, a non-number where the game wants one (`\C[red]`), the wide `＼`. The same text in the original is the game's own and is not flagged.
- `uk-homoglyph`: a Latin letter drawn like a Cyrillic one inside a Ukrainian word (`Cила`), a Cyrillic word that is really `HP`/`XIX` of the original, a lone Latin `i`/`a`/`o`/`y`/`c` between Ukrainian words. Latin that stands in the original, the built-in list (HP, MP, NPC, units, Roman numerals, `x2`, `3D`) and the project's list «Латинські слова, які можна лишати» are left alone. The fix is offered only when every letter has a pair in the other alphabet.
- `uk-foreign-letters`: `ы э ъ ё` and the other Cyrillic letters outside the Ukrainian alphabet (no automatic fix).
- `uk-normalization`: «й» and «ї» written as two characters (fixed to one).
- `ws-hidden`: zero-width characters, soft hyphen, line/paragraph separators, unusual spaces (an emoji joiner is left alone; a normal no-break space too).
- `ws-edges`: spaces and line breaks at the start or end differ from the original. In names, terms and plugin texts they must match; in dialogue lines only what was *added* is flagged, since the original's trailing spaces mean nothing.
- `ws-double`: two spaces in a row that the original does not have.
- `uk-apostrophe`: a wrong sign (`` ` ´ ‘ ′ " ``) between two Ukrainian letters; optionally one apostrophe for the whole project (`’`, `ʼ` or `'`).

The overview of advices: the status bar shows «Поради: N» (click to filter), the filter chip «З порадами», Перехід → Наступна порада, a small ring in the table. A length that differs from the original is not counted there (it stays a recommendation under the field). In the tool, each rule shows how many rows of the open file it found and **Виправити в файлі**: one action of the journal («виправлено за правилом»), statuses stay as they are, **Скасувати** takes it back. More rules (end punctuation, numbers, repeated words, quotes and dashes, placeholders) come later.

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
- **Update by the glossary** (a change of a term follows its rows): when you change how a glossary term is rendered (`sword: меч` → `клинок`), a message says how many rows hold the old rendering — in **any case and number** (`мечем`, `залізних мечів`, `мечі`) — and **Переглянути** opens the list: every row as «було → стане» with the same case of the new rendering (`клинком`, `сталевих клинків`), a mark of how sure it is (*впевнено* / *перевірте* / *сумнівно*) with the reason on hover, a choice of another form where the old form fits several cases (`слова` can be genitive singular or nominative plural), and a tick. Only the sure replacements where the original really has the term are ticked; a row without the term in its original (a different word that looks alike) is never ticked. The rows keep their status (a sent or approved row stays sent or approved); the history shows «змінено термін», and **Скасувати** (or Ctrl+Z) takes the whole action back. Tools → «Оновити за глосарієм…» does the same for a term and an old rendering you type in (also from another device's change). On the phone a banner in the glossary and a screen in Tools do the same.
  - How the forms are found: no dictionary is built in (VESUM is not allowed by its licence). The old term's whole paradigm (7 cases × 2 numbers) is generated by rules (declensions I–IV, hard/soft/mixed stems, fleeting vowels, і→о/е, genitive -а/-у, third-declension -ь and -ість, irregular words, adjectives that agree with the noun, phrases with a head word and a dependent genitive, hyphenated compounds such as `меч-кладенець`), and a word of the text counts as a form of the term only if it is in that paradigm (`мечник` is not a form of `меч`). The same case of the new term is generated; the case of the letters follows the text (`Мечем` → `Клинком`, `МЕЧЕМ` → `КЛИНКОМ`) and a preposition before the phrase narrows the case. Every step has a weight: regular endings are *high*; a word that has a lexical choice and is on none of the short hand-made lists (genitive -а or -у, a vowel that may drop, an і that may turn into о) comes out *medium*, and a form that fits several cases that give different results *low*. Spot-check the result in the real game: the rules are right for regular words and honest about the rest, but they are rules, not a dictionary.
- Tools → **Find and replace** (previews every change, you tick what to change) and **Linked rows**.
- **The editing view as cards** (PC): the captions of the original and of the translation are one line between the two boxes, joined by a long arrow from the first to the second (the chip «≡ N» of the rows with the same original stands before the caption of the translation); the translation field and its plate are one rounded box with one ring: a dark field over a lighter plate with the bin, the counter (the translation over the original, as a fraction, amber when the length leaves the tolerance) and the send button. The remarks of the row (the width of the game window, the checks of the QA) are one card «Зауваження · N» under the field, with their buttons; it is not there while there is nothing to say. The threads are a card of their own. All cards share the look of the tool windows: a lighter header over a dark body.
- **The rows window header**: «Рядки» and the name of the file, like the header of the panel; at its right the menu ⋮ (the order, the filters, «Пошук у файлі Ctrl+F», reset, hide) and «—». There is no row of buttons and no search field under it: the search is a field that takes the place of the title when it is opened (the menu or Ctrl+F; Esc clears it, then closes it). Under the header stands a strip of what is switched on (statuses, the speaker, the order, «Скинути») only while something is, and the menu then carries a dot.
- **The headers of the files and the scenes** are the same: the name (and the file) with the menu ⋮ and «—»; the search is a field in the header (Ctrl+F in the window, or the menu), Esc clears it and then closes it, and an empty field goes back to the title by itself when it is left. The menu ⋮ of the files holds the search and «Групи ▸» (all the files together, a new group, and for the picked files: open together, add to a group ▸, clear the picks). The ⋮ is shown while the window is touched (like «—»), and stays while it has a dot, an open field or an open list.
- **Menus are multi-level**: an item with ▸ opens its list beside the menu (on hover after a short wait, on a click, or →); the menu stays open, a list can lead on to another list; ← or Esc closes the last list only; a choice, a click outside or Esc on the menu closes them all. The current choice has a ✓. The order and the filters of the rows are lists of the menu ⋮ of the rows.
- **The padding of the game's own strings is kept in the build**: a name, a term, a menu command or a plugin text (not a message) gets the spaces and line breaks the original has at its edges (` Continue` with a space before it puts the command in its place on the title screen); the editor's advice «Пробіли на краях» says the same before the build. Messages are left as the translator wrote them (`core/edges.ts`).
- **The Windows app updates itself in the background** (Settings → Оновлення, «Оновлювати у фоні», on by default): while it works it looks for a new release every few hours, fetches the installer into its data folder and checks it against the SHA-256 that GitHub gives, with no window and no question. A downloaded version shows the chip «↻ Оновлення готове» in the status bar. The installer runs without a window (`/S`, for the current user, no UAC) **when the app is closed**, after the process has ended; a press on the chip closes the app the usual way (what is typed is saved first), installs and starts it again. The installer is checked once more right before it is started; if it is changed or the sum is missing, nothing runs. Android still asks once (the system installer cannot be silent).
- **Related to a row** («Пов’язане», PC editor; the lines drawn from a word of the original to its translation are its «нитки»): under the translation a line of chips shows every glossary entry the original contains (a word, a phrase, a construction with a gap such as «take … off», a name from the game), each in its own colour: the colour of its underline in the original and in the translation, a ✔ when the translation has it and a ▲ when it lacks it. No line is drawn at rest: pointing at a chip (or at the word) draws the thread from the word in the original to its place in the translation (the parts of a construction are joined by a dashed arc), a click on the chip keeps the thread drawn, and the small ▾ opens the card of the entry (its rendering across the game, the other rows that use it and, closed until asked, a table of its forms by case). «Узгодити (k)» on a chip goes through the rows that render the entry another way. The rows that share the original are not a thread: the chip «≡ N» at the right of the label of the translation opens a card with what the others hold (the words that differ marked) and the actions below.
- **Linked rows**: rows whose original is exactly the same (spaces at the ends do not count) are linked by themselves; nothing is stored for the pair. When one of them is sent, the empty ones are filled at once as one action (with **Скасувати**) as **drafts marked «авто»** (they do not count as sent until you look at them and send them; proofread rows are never overwritten), and the ones whose text differs are offered for a look: «Зв’язаних рядків відрізняється: N · Переглянути» opens a list with a was → will be line per row and ticks (empty and older ones are ticked; a row you changed later than the reference is not, and is never overwritten by itself). What the others are compared with is the **main** translation when you chose one (right panel → «Зробити головним»), otherwise the row sent last; a draft never spreads. A row can be **unlinked** and linked again. In Settings the mode is *ask* (default), *update by themselves* or *do not link*; a project made before this feature that had the copying off stays off. The right panel section «Зв’язані рядки» (and the card under the translation on the phone) shows the states: main, same, without translation, differs, changed later, unlinked. Tools → «Зв’язані рядки…» lists every cluster that does not agree: keep one variant (it becomes the main one and the rest, also the empty rows, take it) or fill the empty ones. Only the exceptions are saved in the project (`links`: unlinked rows and chosen main rows, each with a hash of the original, so a game update that shifts row numbers never applies a link to a different line); they travel through sync and merge item by item like groups. Similar (not identical) originals stay proposals (translation memory, autofill by words).

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
- **Phone, in short:** the table only where there is room (a landscape phone: a rail of buttons on the left, the editor in two columns); one row of filters on the Rows screen; the keyboard never covers the field (one row of actions while it is up, the remark of the QA stays under the field); the hints sheet and the tools menu come up from the bottom, like the term card; a tap on a term or a control code (a card with its meaning) goes to the nearest one when it misses; every bulk action says how many rows and why some were left out, and carries «Скасувати».
- **Phone, like the desktop:** ✓ approve and the paper plane send (also for a selection: ✓, «З пам'яті», «Оригінал», «Очистити»), «Повернути на доопрацювання» for a sent row, the filter «З коментарями», ‹ › between scenes and «Вичитати» for a whole scene, a group of files opened as one list of rows.
- The phone app: Файли → Рядки → Переклад → Ще, bottom navigation, swipe between rows, bottom sheet with glossary/memory/comments/history, **groups of files** (select files → «У групу»), a scene screen where the picked line is translated in a field on the spot, the same ✓ approve and paper-plane send as on the desktop, bulk send/clear with «Скасувати», GitHub/Claude sync and in-app updates in «Ще».
- `UIUX-REVIEW.md` keeps the last UI/UX review and the waves that follow from it.
