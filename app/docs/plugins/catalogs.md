# Catalogs

A **catalog** is a list of plugins somebody recommends. It does not hold the plugins: it **describes** them and says **where each one is**. The manager shows it in **Файл → Розширення… → Каталог**, where an entry installs in one click, through the same consent screen as any plugin (what it adds and asks for is shown first, nothing is written without agreement, every file is checked against its checksum).

## What comes with the application

The catalog page always lists the **examples** the application carries (`examples/plugins`): they install without a network. Their entries are made from their manifests, so they cannot differ from what installs.

## Adding a catalog

On the same page, **Додати каталог**: `author/repository` (optionally `@ref` and `#folder`, the file `transly-catalog.json` is read from the repository at `raw.githubusercontent.com`) or the **https** address of a catalog file. Up to eight catalogs are kept on the device with their last answer, so the page opens at once; the network is asked only for **Оновити списки**. Where the same plugin is in several catalogs, the newer version is shown.

## The file

```json
{
  "catalogVersion": 1,
  "name": "My catalog",
  "plugins": [
    { "id": "acme.wolf", "name": "Wolf RPG Editor", "description": "…", "version": "1.2.0", "author": "Acme",
      "tags": ["engine", "format"], "repo": "acme/transly-wolf@v1.2.0",
      "detect": { "anyFiles": ["**/*.wolf"], "min": 1 }, "requires": { "transly": ">=0.1.0" } },
    { "id": "pl.interface", "name": "Polski", "tags": ["language"], "languages": ["pl"], "url": "https://example.com/pl/transly-plugin.json" }
  ]
}
```
A schema is in [`catalog.schema.json`](catalog.schema.json), an example in [`examples/catalog`](../../examples/catalog).

| Field | Meaning |
|---|---|
| `id`, `name` | the plugin's id (`author.name`, the same as in its manifest) and the name shown |
| `description`, `version`, `author`, `homepage` | shown in the list (`homepage` is an https address). The version is compared with the installed one: a newer one is offered as an update |
| `tags` | what it adds: `language`, `engine`, `format`, `qa`, `commands`, `glossary`, `help`; the page filters by them |
| `languages` | the codes of the interface languages of a language pack |
| `repo` **or** `url` | where it is: a GitHub repository as in **Додати → GitHub** (`owner/repo[@ref][#folder]`), or the https address of its `transly-plugin.json` or of a `.zip` / `.transly-plugin` package. Exactly one of them |
| `detect` | how a game of the kind it reads is told from its files (the same shape as `contributes.engines[].detect`: `files`, `anyFiles` with `min`, `excludeFiles`, patterns with `*` and `**`). When the application meets a folder it does not understand and **an entry of a catalog fits its files**, it says so and offers it |
| `requires.transly` | the versions of Transly it works with; an entry that does not fit is shown as not installable |

## What is checked

A catalog is untrusted text. It is limited to 1 MB and 500 entries. Every entry is checked on its own: a wrong id, an `http:` address, an unknown tag, a bad version… leaves **that entry** out (the page says how many were skipped) and keeps the rest. A catalog written for a newer format (`catalogVersion` above what the application knows) is refused. Nothing in a catalog is ever run, and a catalog can only point at places a plugin can be installed from anyway: the plugin still shows its own consent screen and is checked against its own manifest.

## Making one

Put `transly-catalog.json` in the root of a GitHub repository (people add it as `you/your-catalog`), or on any https server. Keep `version` in step with the plugin's manifest (the plugin's own manifest is what is installed and checked; the catalog only tells people there is a newer one).
