# Example plugins

Each folder is a complete plugin. Install one from **Файл → Розширення… → Додати → З файлу** (select its files), or make an archive with `node scripts/plugin-pack.mjs examples/plugins/<name> --zip out.transly-plugin`.

| Folder | Shows |
|---|---|
| [`lang-files`](lang-files) | a **format described by data** (`keyvalue`) and a help topic in a file |
| [`json-dialogs`](json-dialogs) | an **engine** recognised from the list of files (a made-up one, for the example), a `json` format with wildcards and speakers, help for the engine's guidance |
| [`style-pack`](style-pack) | **rules of QA**, **commands** (a replacement, a help topic, a link) and **glossaries** (inline and from a `.tsv`), all as data |
| [`lang-english`](lang-english) | a **language pack**: a `.po` for the `core` context and one string of another plugin |

The examples are checked by the test suite (`test/ext-examples.test.ts`): their checksums must be up to date and they must install and work, so they cannot silently rot. Do not edit a file without running `node scripts/plugin-pack.mjs <folder>` after it.
