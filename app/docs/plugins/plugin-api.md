# Plugin API (version 1.0)

This is the reference for the manifest and for what a plugin can contribute. See the [examples](../../examples/plugins) for complete plugins.

## The package

A plugin is a folder (or a `.zip` / `.transly-plugin` archive) that holds `transly-plugin.json` and the files it lists. Rules the application enforces:

* every file other than the manifest is **listed in `files` with its SHA-256** (`"sha256-<64 hex>"`), and nothing unlisted is accepted; use [`scripts/plugin-pack.mjs`](../../scripts/plugin-pack.mjs) to write the checksums;
* files are **UTF-8 text** (catalogs, help, code); binary files are refused;
* at most 200 files, 2 MB per file, 8 MB in all; the manifest at most 200 KB;
* paths are relative, with `/`, no `..`, no hidden parts (`.git`, `.DS_Store`), only letters, digits and `_ .()+-`.

## The manifest

```jsonc
{
  "manifestVersion": 1,                     // required: the version of this format
  "id": "acme.wolf-rpg",                    // required: author.name, lower case letters/digits/-, 2+ parts, ≤ 64
  "name": "Wolf RPG Editor",                // required, ≤ 80
  "version": "1.2.0",                       // required: semantic version
  "description": "…",                       // ≤ 600
  "sourceLanguage": "en",                   // the language the plugin's own strings are written in (default en)
  "author": "Acme" ,                        // or { "name": "Acme", "url": "https://…" }
  "license": "MIT",
  "homepage": "https://…",                  // https only
  "repository": "acme/transly-wolf",        // owner/repo, or an https address: where updates are looked for
  "keywords": ["engine", "wolf"],
  "requires": { "transly": ">=0.1.0", "api": "^1.0.0" },
  "dependencies": { "acme.base": "^1.0.0" },// other plugins this one needs
  "permissions": [],                        // for plugins with code only: network, storage, notify
  "main": "plugin.js",                      // the code of the plugin (see security.md: not run in this build)
  "contributes": { "formats": [], "engines": [], "languages": [], "help": [], "settings": [] },
  "files": { "i18n/pl.po": "sha256-…" }     // the checksums of every other file
}
```

The `id` part `transly` is reserved for the built-in plugins. A manifest is parsed, every field is checked for its type, length and form, and anything the application does not know is left out. The same checks run when a plugin is installed and every time it is loaded.

### Version ranges

`requires` and `dependencies` use npm-style ranges: `1.2.3`, `^1.2.0` (compatible: `>=1.2.0 <2.0.0`, for `0.x` the minor is the limit), `~1.2.3` (`>=1.2.3 <1.3.0`), `>=1.0.0 <2`, `1.x`, `*`, and `a || b`. A pre-release (`1.0.0-beta.1`) satisfies a range only if the range names a pre-release.

### States of a plugin

| State | Meaning |
|---|---|
| `enabled` | works |
| `disabled` | switched off by the user (built-in plugins can be switched off too) |
| `incompatible` | `requires.transly` or `requires.api` does not match this application |
| `missing-dependency` | a plugin it depends on is not installed, is off, or is the wrong version |
| `error` | the files were changed or damaged since installation, or the code did not load |

## `contributes.formats`

A **format** reads the rows (*units*) out of one file and writes translations back.

| Field | |
|---|---|
| `id` | local id, unique in the plugin (`a-z 0-9 _ -`); the application calls it `<plugin id>/<id>` |
| `label` | name shown to the user |
| `extensions` | `[".lang"]`, with the dot, lower case |
| `files` | optional name patterns when the extension is too broad (`**/scenes/*.json`) |
| `text` | `true` for a text file, `false` for JSON |
| `spec` | **how to read and write the file, as data** (below) |
| `priority` | −50…50, default 0. Higher is asked first. Built-in formats are 80–100, so an installed format never takes a file the application already reads |
| `help` | id of a help topic about this format |

When two formats claim a file, the first in order is used: built-in before installed, then higher `priority`, then the order of installation. The manager warns about overlaps before you install.

### `spec`: formats described as data

The application's own tested code reads and writes the file, so a plugin that only *describes* a format has nothing to trust. The input is never changed; what a translator did not touch comes out as it came in.

**`keyvalue`**: `key=value` lines (`.lang`, `.properties`, `.ini`).

```json
{ "type": "keyvalue", "separator": "=", "comments": ["#", ";"], "unescape": true }
```
A key that repeats becomes `key#2`, `key#3`. With `unescape`, `\n` in a value is a line break while you translate and is written back as `\n`. Line endings and a BOM are kept.

**`table`**: CSV or TSV with a header (or counted columns).

```json
{ "type": "table", "delimiter": "auto", "header": true,
  "key": "id", "source": "text", "target": "translation", "speaker": "who", "context": "scene", "kind": "dialogue" }
```
`key` may be several columns (`["scene", "line"]`, joined with `:`). If `target` names a column that does not exist the header gets a new one.

**`json`**: values at paths of a JSON tree.

```json
{ "type": "json", "rules": [
  { "path": "title", "kind": "name" },
  { "path": "scenes[*].lines[*].text", "kind": "dialogue", "speaker": "who" },
  { "path": "items.*.name", "kind": "name" } ] }
```
Paths are `a.b[0].c`; `[*]` is every element of a list, `*` every key of an object. `speaker` and `context` name a sibling key of the same object. Only string values are rows. The row key is the concrete path (`scenes[0].lines[1].text`). Paths through `__proto__`, `constructor` or `prototype` are refused.

`kind` is one of `dialogue`, `choice`, `scroll`, `name`, `description`, `message`, `term` (default `message`).

## `contributes.engines`

An **engine** tells the application what kind of game a folder holds, so it can explain itself when it cannot read the folder.

```json
{ "id": "wolf", "label": "Wolf RPG Editor", "description": "…",
  "formats": ["wolf-data"],
  "detect": { "files": ["data/basicdata/game.wolf"], "anyFiles": ["**/*.wolf"], "min": 1, "excludeFiles": ["**/system.json"] },
  "dataFolders": ["data"],
  "features": ["scenes"],
  "help": "open" }
```

`detect` is evaluated on the **list of file paths** of the picked folder (lower case, `/`, relative to it): all `files` must be present, at least `min` (default 1) of `anyFiles`, none of `excludeFiles`. In a pattern `*` is any characters inside one name, `**` is any number of folders, case does not matter. The result is a score (the share of patterns matched); the best match is told to the user. Engines of plugins that are **switched off** are still recognised, so the guidance can say «this looks like X; its plugin is off, switch it on».

`features` are names of abilities the interface may offer for the engine. The built-in RPG Maker plugin lists `scenes`, `play-scene`, `speakers`, `plugin-texts`, `game-window`, `game-images`, `game-names`; other plugins may list their own names and the interface can check them (`plugins.features()`).

## `contributes.help`

```json
{ "id": "open", "title": "How to open a game", "topic": "engine:wolf", "body": "Pick the folder…" }
{ "id": "about", "title": "About formats", "file": "help/about.md" }
```
`topic` is `general` (the list of help topics) or `engine:<local engine id>` (the guidance about that engine). A text is Markdown-like: paragraphs, `- ` lists, `**bold**`, `` `code` ``, `[text](https://…)`. It is **escaped first**, only these forms become markup and only https links are made; help can never put HTML or a script on the page.

## `contributes.settings`

```json
{ "id": "options", "title": "Options", "fields": [
  { "key": "mode", "type": "select", "label": "Mode", "options": [{ "value": "fast", "label": "Fast" }], "default": "fast" },
  { "key": "strict", "type": "boolean", "label": "Strict", "scope": "project" } ] }
```
Types: `boolean`, `string`, `number` (`min`, `max`), `select`. `scope: "app"` (default) is kept on the device; `"project"` is kept in the project (`settings.pluginSettings`) and travels with it. The values are shown in the plugin's page in the manager.

## `contributes.qaRules`

Rules of QA written as data. The application runs them with its own rules (they appear in **Правила QA** with the name of the plugin; the project can switch each off or make it an error, and the translator can ignore a remark of one like any other). The id of a rule in the project is `<plugin id>:<local id>`.

```json
{ "id": "no-slang", "title": "No slang", "severity": "warn",
  "check": { "type": "forbid", "items": [{ "find": "круто", "replace": "чудово", "wholeWord": true }] } }
{ "id": "address", "title": "Address Sir", "check": { "type": "require", "when": { "find": "Sir", "wholeWord": true }, "then": { "find": "пан" } } }
{ "id": "short-names", "title": "Names fit", "severity": "bad", "kinds": ["name"], "check": { "type": "maxLength", "max": 24 } }
{ "id": "translated", "title": "Not left as it was", "check": { "type": "sameAsSource" } }
```
* `forbid`: the translation must not contain any of the `items`. A word that stands in the original is the game's own and is left alone. When every item found has a `replace`, the remark carries a ready fix.
* `require`: when the original has `when`, the translation must have `then`.
* `maxLength`: the translation (without control codes) is not longer than `max` characters.
* `sameAsSource`: the translation is not just the original (a row with fewer than four letters is never flagged).
* `severity`: `warn` (an advice, the default) or `bad` (an error: the row cannot be sent or built until it is mended). `kinds` limits a rule to rows of those kinds. `message` is the plugin's own wording; without it the application's is used.

A pattern is **plain text**: `wholeWord` and `caseSensitive` are the only options, the apostrophe `'` `’` `ʼ` is one letter, control codes (`\C[2]`) are not text. There are no regular expressions on purpose: a pattern written by a stranger could make the program hang. Several items do what an alternation would. A rule that fails is skipped and recorded against its plugin.

## `contributes.commands`

Commands shown in the menu **Інструменти** (under the fixed items, with the plugin's name) and in the plugin's page.

```json
{ "id": "tidy", "title": "Tidy punctuation", "action": "replace", "steps": [{ "find": "...", "replace": "…" }, { "find": " - ", "replace": " — " }] }
{ "id": "guide", "title": "House style", "action": "help", "help": "guide" }
{ "id": "site", "title": "Orthography", "action": "link", "url": "https://pravopys.net/" }
```
* `replace`: the `steps` are made in order on every translation of the project. A preview lists every change with a tick to leave one out; proofread rows are skipped unless asked (they become drafts); the result is one step in the history and can be undone.
* `help`: opens one of the plugin's own help topics (`help` is its local id).
* `link`: opens an `https` address in the browser.

## `contributes.glossaries`

Lists of terms to add to a project's glossary, from the plugin's page («Додати до проєкту…»).

```json
{ "id": "address", "title": "Forms of address", "terms": [{ "en": "Sir", "uk": "пане" }, { "en": "Madam", "uk": "пані", "alt": ["мадам"] }] }
{ "id": "fantasy", "title": "Fantasy basics", "file": "terms.tsv" }
```
A file is a `.json` list of the same objects, or a `.tsv`: original, tab, translation, tab, alternatives with `;`, tab, a note (lines starting with `#` are comments). A preview shows what is new, what the project has the same way, and what it translates differently: **a term the project already has is never replaced**, only the new ones are added, and the glossary syncs between devices like any term.

## `contributes.languages`

See [language-packs.md](language-packs.md).

## Lifecycle and failures

* **Install**: fetch → check the package (manifest, checksums, limits) → *plan* shown to the user (what it adds, permissions, warnings, whether it is an update) → written only after consent → loaded. A failure rolls back to the previous state.
* **Load** (at start): every stored plugin is checked again; a plugin whose stored files were changed or damaged is listed with its reason and does not run; one bad plugin never stops the others or the application.
* **Failure at run time**: an exception in something a plugin handles is recorded against that plugin (shown in its page, once as a notice) and the caller gets the answer it would get if the plugin were absent: no rows for a file that could not be read. **Writing** is stricter: a build whose plugin cannot write a file **stops with a message** instead of passing the original off as translated.
* **Removal**: refused for built-in plugins (switch them off instead); plugins that depend on the removed one drop to `missing-dependency`.

## Values the application takes from a plugin

Rows returned by a plugin are cleaned: keys must be non-empty text, unique and safe (`__proto__` etc. are prefixed), `source` must be text of a sensible size, `kind` is one of the known kinds. Anything else is dropped.
