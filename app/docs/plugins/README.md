# Transly plugins

Transly is a workspace for translating games. The part that is the same for every game (the table, the editor, the glossary, translation memory, QA, branches, sync) is the **core**. The part that is about one kind of game or one kind of file (how a game is recognised, where its texts are, how a translation is written back) is a **plugin**.

RPG Maker MV/MZ and the open text formats (gettext, CSV/TSV, JSON locale files, Ren'Py) are **built-in plugins**: they ship with the application, are switched on by default and use the same door as every plugin you install. Everything else can be added by the user: support for another engine or file format, a language of the interface, help for a kind of game.

| You want to… | Read |
|---|---|
| write a plugin (a format, an engine, help, settings) | [plugin-api.md](plugin-api.md) |
| translate Transly itself, or a plugin, into another language | [language-packs.md](language-packs.md) |
| publish a plugin (GitHub, any server, a file) and keep it up to date | [publishing.md](publishing.md) |
| list plugins for others to find (a catalog), or use one | [catalogs.md](catalogs.md) |
| know what the application guarantees and what a plugin can do | [security.md](security.md) |
| validate a manifest in an editor | [plugin.schema.json](plugin.schema.json) |
| see working examples | [`../../examples/plugins/`](../../examples/plugins) |

## The idea in one page

A plugin is a **folder or a zip** with a `transly-plugin.json` (the *manifest*) and the files the manifest lists. The manifest says who the plugin is and what it **contributes**:

```json
{
  "manifestVersion": 1,
  "id": "acme.lang-files",
  "name": "Lang files",
  "version": "1.0.0",
  "contributes": {
    "formats": [{ "id": "lang", "label": "Lang file", "extensions": [".lang"], "text": true,
                  "spec": { "type": "keyvalue" } }]
  }
}
```

| Contribution | What it is |
|---|---|
| `formats` | how a kind of file is read and written (described as **data**: `keyvalue`, `table`, `json`) |
| `engines` | how a game is recognised from the list of its files, which formats it uses, which folder holds its data, the help about it |
| `languages` | catalogs of strings for an interface language (`.po` or `.json`), for the core and for other plugins |
| `qaRules` | rules of QA as data (forbid, require, maximum length, not-just-the-original); they work with the application's own rules |
| `commands` | entries of the menu «Інструменти»: replacements with a preview and undo, a help topic, an https link |
| `glossaries` | lists of terms a user adds to a project's glossary after looking at them |
| `help` | help topics, shown in the manager and in the guidance about a game that cannot be read |
| `settings` | parameters (switch, text, number, choice) kept on the device or in the project |

The application **reads the manifest before running anything of the plugin**, so it knows what a plugin offers, what it needs (`requires`, `dependencies`) and what it asks for (`permissions`) before the user agrees to install it. A plugin that is switched off, does not fit this version of the application, lacks something it depends on, or fails to load is simply **not asked**: the rest of the application works as if it were not there.

## Architecture

```
┌────────────────────────── core (src/core) ───────────────────────────┐
│  model · project · merge · QA · TM · glossary · build · sync · …      │
│                                                                       │
│  engine.ts ──asks──▶ plugins (PluginRegistry)  ◀── ExtHost ── store  │
│     formatOf(file) · extract(file) · apply(file, translations)       │
│                                                                       │
│        ┌─────────────── ext/ (the framework) ───────────────┐        │
│        │ manifest · semver · registry · host · sources       │        │
│        │ package/zip · declarative formats · i18n · strings  │        │
│        └──────────────────────────────────────────────────────┘        │
└───────────────▲───────────────────────────▲───────────────────────────┘
                │ registered at start        │ installed by the user
     built-in plugins                  plugins in IndexedDB
     transly.rpgmaker                  (files · github · url)
     transly.text-formats
```

* **`core/engine.ts`** keeps the functions the rest of the application always used (`formatOf`, `extract`, `apply`, `isTextFormat`, `readableExtensions`); they now ask the registry. Nothing that called them changed.
* **`core/ext/registry.ts`** knows every plugin and its state (`enabled`, `disabled`, `incompatible`, `missing-dependency`, `error`), orders formats (higher priority first, built-in before installed), recognises engines from a list of files, serves help, and isolates the failures of a plugin.
* **`core/ext/host.ts`** installs, updates, removes and loads plugins and keeps the store and the registry in step. A package is checked **before** anything is written and again every time it is loaded.
* **`core/ext/i18n.ts`** is the localization: catalogs by context, plural rules, fallbacks, switching at run time.
* **`ui/ext-dialog.ts`** is the manager («Файл → Розширення…»), **`ui/guidance.ts`** is what the user sees when a folder cannot be read, **`ui/i18n-dom.ts`** puts a language pack on the screen.

## Compatibility

Existing projects, settings and data are unchanged: a project does not store which plugin read its files, only the rows. A project whose plugin was removed still opens (from the copy of the originals it keeps); only *building* needs the plugin, and the build says which files it could not write instead of silently leaving them untranslated.

Two versions matter:

* **the application version** (`requires.transly`, e.g. `>=0.1.0`);
* **the plugin API version** (`requires.api`, e.g. `^1.0.0`). Its major number changes only when something that a plugin may rely on is removed or changes meaning; new fields and new contribution kinds raise the minor number and are ignored by older readers (a *warning* when the manifest names a contribution the application does not know, not an error).
