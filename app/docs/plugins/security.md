# Security and reliability

A plugin comes from someone the user may not know. The design starts from that.

## What a plugin is, and what that means

**A plugin is data first.** Everything a plugin can contribute today (formats, engines, languages, help, settings, rules of QA, commands, glossaries) is *declared* in the manifest and its text files. The application's own tested code reads the declarations, so installing such a plugin **does not run anyone else's code** in the application. A declared format can only do what `keyvalue`, `table` and `json` do: pick text out of a file and put a translation back. A rule of QA is one of four fixed checks over plain text; a command is a list of plain-text replacements, a help topic or an https link. **There are no regular expressions in manifests on purpose**: a pattern written by a stranger can make a regular-expression engine run for hours on one row and freeze the program, and a deadline cannot be put on a single match. A replacing command never writes without a preview, skips proofread rows unless asked, and is one undoable step; a glossary never replaces a term the user already has.

**Plugins with code are not run in this build.** The manifest accepts a `main` script and the permissions `network`, `storage`, `notify` (the vocabulary of the API), and the install flow already treats such a plugin more strictly (it is installed switched off, the consent screen says it contains code, every permission is a separate checkbox, an explicit «I trust the author» is required). But the application has no **sandbox to run that code in** yet; until it has, a plugin with `main` is listed with the reason «the code cannot run here» and nothing of its code is executed. The reason is deliberate: the application's content-security policy forbids foreign scripts, and a plugin that ran in the application's own context could read the project and the sync tokens. The design for the runner (below) keeps that guarantee.

## What the application checks

| Threat | What happens |
|---|---|
| A tampered or damaged package | every file is listed in the manifest with a SHA-256 and compared; a file that is not listed, or does not match, refuses the whole package. The stored files are compared **again at every start** (a plugin whose files were changed behind the application's back does not run and is shown with the reason). |
| A hostile manifest | it is parsed as data and every field is checked for type, length and form; unknown parts are dropped; ranges, ids, paths, extensions, hosts and patterns have strict shapes; the manifest is capped at 200 KB. |
| A path out of the package (`../`) | refused in the manifest and in archives; names with `\`, drive letters, hidden parts are refused. |
| A zip bomb or a huge package | sizes are limited before and while unpacking (an entry that unpacks into more than it declares is refused); at most 200 files, 2 MB each, 8 MB in all; no zip64, no encryption. |
| Binary or odd files | every file must be valid UTF-8 text without NUL. |
| A plugin that takes the place of another | a built-in id cannot be replaced; the `transly` part of the id is reserved; an update from another source than the one installed is flagged on the plan. |
| Overlapping formats | built-in formats always win; the plan warns when a plugin claims files another one already reads. |
| Hostile rows | rows are cleaned (key, source text, kind, sizes); keys like `__proto__` are made safe; JSON paths through `__proto__`/`constructor`/`prototype` are refused; the input of a format is never changed. |
| Hostile help text | the Markdown subset is **escaped first**, only https links are made. |
| Hostile language pack | the plural rule is read by a small parser, **never evaluated as code**; strings are put on the screen as text, never as markup. A pack cannot translate game text (the layer skips the table, the editor, rows, scenes, file names). |
| Network | only `https` (and `http://localhost` for development); no credentials in addresses; redirects to unsafe addresses are refused; every download has a size limit and a time limit. GitHub packages are read at **one commit**, which is recorded. |
| A failing plugin | an exception is caught, recorded against the plugin and shown; the caller gets the answer it would get without the plugin. A plugin that cannot **write** a file stops the build with a message rather than silently passing the original as translated. |

## What the user sees and decides

The user always sees a **plan before anything is written**: name, version, author, source (and the commit), what is added, permissions, warnings (overlaps, missing dependencies, another source, not compatible), and whether it is an install, an update or a downgrade. Plugins can be switched off at any time and removed; removal needs a second click.

## The runner for code plugins (design)

Code needs a place where it **cannot reach the project, the tokens or the net**, and where a runaway loop can be stopped. The design is:

* the plugin's script runs in a **Worker** created from a blob, after a bootstrap that removes everything not on an allow-list of safe language features (`fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `importScripts`, nested workers, `postMessage` and the rest are gone from the plugin's view);
* it talks to the application only through a **versioned message protocol** (`extract`, `apply`, `detect`…), every answer validated like the rows above, every call with a time limit; a worker that does not answer is **terminated**;
* what it asks for (`network`, `storage`, `notify`) is done **by the application for it**, only for the hosts the manifest lists and the user allowed;
* the content-security policy changes by one directive (`worker-src blob:`) in the three places it is defined.

A worker in the page's origin is not a hard boundary against a determined attacker, which is why it is gated behind explicit consent and the «I trust the author» step; the recommendation to users stays: **install code only from authors you trust**.
