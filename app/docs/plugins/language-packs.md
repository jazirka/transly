# Language packs

A **language pack** is a plugin whose job is to translate the interface of Transly, and the strings of other plugins, into another language. You do not have to be a programmer to make one: a pack is a text file of translations (`.po`, the format translators already use) and a short manifest.

## What comes with the application

**English** is built in: it is on from the first start, appears in **Мова інтерфейсу** next to Ukrainian, and can be switched off like any built-in plugin. It lives in `src/lang/en.po` (context `core`, which also holds the names, descriptions and help of the built-in plugins) and is registered as the plugin `transly.lang-en`. Whatever the pack lacks is shown in Ukrainian.

To add another language to the application itself (rather than as an installable pack): put `src/lang/<code>.po` next to `en.po` and add one line to `BUNDLED_LANGUAGES` in `src/lang/index.ts`; the plugin `transly.lang-<code>` is made from it. Two checks keep a bundled pack honest (`test/lang-en.test.ts`): every `{1}`/`{name}` of the source is kept in the translation, and every string of the built-in plugins has a translation. Counts follow the language: a pack may give both forms of a count word (`msgid "{1} рядок"`, `msgstr[0] "{1} row"`, `msgstr[1] "{1} rows"`) and «1 рядок», «5 рядків» both find it.

## How the interface is translated

The program's own texts are written in **Ukrainian** (the *source language*). A pack says what each text is in another language. A text is found by its words (the *message id*) inside a **context**:

| Context | Whose strings |
|---|---|
| `core` | the application itself: menus, dialogs, settings, notifications, errors, guidance |
| `plugin:<plugin id>` | the strings a plugin shows (its name, description, help, settings, format names) |

A pack may hold **any contexts**, so it can translate a plugin whose author knows nothing about your language. What is not in the pack is shown in the source language (or in a *fallback* language), so the interface never has holes, and Transly remembers what was missing so you can be given the list.

The language can be switched at any time (**Файл → Розширення… → Мова інтерфейсу**, or **Налаштування → Загальні**); the screen is redrawn at once and the choice is kept.

## Make a pack in 10 minutes

1. **Get the list of strings.** Install any pack for your language (or start without one), choose it in *Мова інтерфейсу*, click through the application (menus, dialogs), then press **Зберегти шаблон (.pot)** in the same page. The template holds every string you saw that has no translation yet. (A template of the strings of one plugin is in its page: **Рядки для перекладу (.pot)**.)
2. **Translate it** in [Poedit](https://poedit.net), Weblate, Crowdin, any text editor, or in **Transly itself** (it opens `.po` files). Fill in `msgstr`; leave the rest.
3. **Make the manifest** (`transly-plugin.json`):

```json
{
  "manifestVersion": 1,
  "id": "yourname.lang-pl",
  "name": "Polski (interfejs)",
  "version": "1.0.0",
  "sourceLanguage": "en",
  "contributes": {
    "languages": [
      { "code": "pl", "name": "Polish", "nativeName": "Polski", "catalogs": [{ "file": "i18n/pl.po" }] }
    ]
  }
}
```
4. **Write the checksums** and check: `node scripts/plugin-pack.mjs path/to/folder`.
5. **Install** it (**Розширення… → Додати → З файлу**) and try it. Publish it as described in [publishing.md](publishing.md).

A complete example is [`examples/plugins/lang-english`](../../examples/plugins/lang-english).

## The `.po` file

```po
msgid ""
msgstr ""
"Language: pl\n"
"Content-Type: text/plain; charset=UTF-8\n"
"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\n"

msgctxt "core"
msgid "Файл"
msgstr "Plik"

msgctxt "core"
msgid "Перекладено {pct}% ({done} з {total})"
msgstr "Przetłumaczono {pct}% ({done} z {total})"

msgctxt "plugin:acme.wolf"
msgid "Wolf RPG Editor"
msgstr "Wolf RPG Editor"
```

* **Keep `{name}` and `{1}`** exactly as they are in the message id: they stand for values (a number, a name) that the program puts in. You may move them in the sentence.
* A string with a number that is written with a digit by the program («Рядків: 12») appears in the template as **`Рядків: {1}`**: it matches any number.
* **`msgctxt`** says whose string it is (`core`, or `plugin:<id>`). A file may mix contexts; or put `"context": "plugin:acme.wolf"` on a catalog in the manifest to give every string of that file one context.
* Entries marked `#, fuzzy` and entries with an empty `msgstr` are ignored.
* **Plural forms.** The header's `Plural-Forms` rule is read by a small parser (it is data, never run as code). If it is missing the rule of the language is taken from a built-in table. Strings with a counted noun have the forms of the source language in the program (Ukrainian: one, few, many) and the forms of *your* language in `msgstr[0]`, `msgstr[1]`…

A catalog may also be **JSON**: `{ "language": "pl", "plural": "n != 1", "messages": { "Файл": "Plik" }, "contexts": { "plugin:acme.wolf": { "Так": "Tak" } } }`.

## Fallbacks, layers, switching

* A string is looked up in the chosen language, then in its base (`pt-BR` → `pt`), then in the `fallback` languages the pack names (up to four), then it stays in the source language.
* If several packs bring the same language, **the pack installed later wins**, string by string; so a small pack can correct a large one.
* When a pack is switched off or removed its strings go away at once; if it was the language in use the interface returns to Ukrainian.
* A pack can also carry a catalog for the **source language itself** (`"code": "uk"`): this is how the strings of a plugin written in English are translated into Ukrainian, or how the wording of the interface is changed.

## What is not translated, on purpose

The **text of the game and of the translation** is never touched: the rows of the table, the editor, the list of rows, scenes, file names, the glossary, comments. A game line that happens to read like a button («Так») stays what it is. Texts that carry a count or a name are translated as a whole when they match a template; a sentence built from pieces on the screen is translated piece by piece.

## When the interface text changes

The message id is the Ukrainian text, so when a release rewords a string the old translation stops matching and that string is shown in Ukrainian until it is translated again. Check a pack against a new release by saving a new template and merging it with your file (`msgmerge`, Poedit «Update from POT», Weblate); what changed is marked fuzzy for you to review.

## For plugin authors

* Write your strings in one language and say which in `sourceLanguage`.
* Put every user-facing text in the manifest or in help files: names, descriptions, format and engine labels, help, setting labels and options. The template in the plugin's page lists all of them (`pluginStrings` in `core/ext/strings.ts`).
* You do not have to ship translations: users and translators can add packs for your plugin on their own (context `plugin:<your id>`). If you do, add a `languages` contribution to your own plugin.
