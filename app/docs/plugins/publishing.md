# Publishing and maintaining a plugin

## Prepare

1. Make the folder: `transly-plugin.json`, the files it names (catalogs, help), optionally `README.md` (listed in `files` like everything else, or kept in the repository outside the plugin folder).
2. Run `node scripts/plugin-pack.mjs <folder>`: it checks the manifest for the mistakes the application refuses and writes the SHA-256 of every file into `files`. Run it again after **every** change; `--check` is for CI (exit code 1 if the checksums are out of date).
3. Try it: **Файл → Розширення… → Додати → З файлу** (select the files or an archive). The consent screen shows exactly what a user will see.

To make an archive: `node scripts/plugin-pack.mjs <folder> --zip my-plugin.transly-plugin`.

## Distribute

The application does not depend on one place. Any of these works, and the user is always shown the plan before anything is written.

| Source | How a user installs it |
|---|---|
| **GitHub repository** | `Додати → GitHub`: `owner/repo`, `owner/repo@v1.2.0`, `owner/repo#folder` or the https address of the repository (also `…/tree/<ref>/<folder>`). Without `@ref` the **latest release** is used, or the default branch when there are no releases. The commit is looked up and **recorded**; the files are read at that exact commit (from `raw.githubusercontent.com`), so what is installed is what you published. |
| **Any server** | `Додати → За адресою`: the https address of `transly-plugin.json` (the files lie beside it) or of a `.zip` / `.transly-plugin` archive. A local development server may use `http://localhost`. |
| **A file** | `Додати → З файлу`: an archive, or the files of the plugin together (a folder). |

**Discovery.** `Додати → Пошук на GitHub` lists repositories with the topic **`transly-plugin`** (sorted by stars), so a plugin becomes discoverable by adding that topic to its repository. No central server is involved.

### A GitHub repository, step by step

1. Put the plugin folder at the root of the repository (or in a subfolder and tell users `#subfolder`).
2. Add the topic `transly-plugin` to the repository.
3. Tag releases with the plugin version (`v1.2.0`) and publish a GitHub **release** for each: users get the latest release, and `@v1.2.0` pins one.
4. In CI run `node scripts/plugin-pack.mjs <folder> --check` so a release never has stale checksums.

## Versioning rules

* Use semantic versions: a **patch** for a fix, a **minor** for something added (a new format, a new language), a **major** for something that changes what existing users rely on.
* Raise `requires.transly` / `requires.api` only when you use something newer; an older application then shows the plugin as «does not fit this version» with the reason instead of failing.
* Keep the `id` forever: a different id is a different plugin. The application refuses to update a plugin from an id that now claims to be someone else (it notices a different source for the same id and says so).

## Updates

**Перевірити оновлення** (in the plugin's page) fetches only the manifest from where the plugin came from and compares versions; nothing is checked in the background. **Оновити** fetches the new package, shows a new plan (it says if the **permissions grew**, so the user can decide again), and replaces the plugin; a failure leaves the old version in place.

## Dependencies and compatibility

A plugin may depend on others (`dependencies`): it works only when they are installed, switched on and of a matching version, and the manager says which one is missing. A plugin may be installed before its dependencies; it simply waits in `missing-dependency`.

## Maintaining a language pack

See [language-packs.md](language-packs.md#when-the-interface-text-changes). Language packs are updated the same way as any plugin.
