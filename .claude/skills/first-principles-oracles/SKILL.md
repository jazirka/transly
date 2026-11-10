---
name: first-principles-oracles
description: Catalogue of external oracles (laws, standards, file-format facts) per audit area, so a teardown auditor judges a product against the world and not against the authors' own tests or notes.
---

# Oracles that do not come from the code under audit

Use these to decide what "correct" means. Write the oracle you used in every finding.

## Data, merging, persistence
- **Merge laws** (for any function that combines two replicas of the same data): commutative `merge(a,b)=merge(b,a)`, associative `merge(merge(a,b),c)=merge(a,merge(b,c))`, idempotent `merge(a,a)=a`, monotone (a merge never loses an item that exists in both inputs, and a deletion made on one side is not undone by the other unless it was made later). Test by generating random replicas (with `fast-check`) and comparing canonical forms.
- **Round trip**: `decode(encode(x)) = x` for every valid `x`, including empty strings, very long strings, lone surrogates, emoji ZWJ sequences, `\u0000`, keys such as `__proto__`, `constructor`, `toString`.
- **Undo**: `undo(do(s)) = s` for every state `s` the action can start from; undoing twice is a redo or a clean no-op, never corruption.
- **Atomicity**: killing the process at any point of a write leaves either the old or the new complete file, never a mix. Test by interrupting writes (throw inside the storage layer, close the page mid-write, reload).
- **Hostile input never crashes the reader**: truncated JSON, wrong types, missing fields, unknown versions, duplicated keys, huge numbers, deep nesting, 100 MB strings. The product must say "cannot read this" and keep the user's existing data.
- **Stable identity**: if rows are addressed by position, reordering/insertion in the source must not silently attach a translation to the wrong row.

## Security
- OWASP Top 10 and ASVS: injection into HTML (`innerHTML`, attribute values, URLs, `javascript:`), unsafe deserialisation, path traversal (`..`, absolute paths, symlinks, Windows drive/UNC/`\\?\` paths, alternate data streams), SSRF/open redirect on any fetch of a user-supplied URL, secrets in logs/URLs/storage, over-broad CSP, unsigned or unchecked updates, command injection through process launch.
- **Tauri**: every `#[tauri::command]` is callable by any script running in the webview — treat the webview as untrusted if it renders hostile text. Check capability scopes, CSP, `withGlobalTauri`, what a command accepts from the frontend, and whether it re-validates paths on the Rust side.
- **Android**: exported components, `allowBackup`, `usesCleartextTraffic`, WebView settings (`allowFileAccess`, `addJavascriptInterface`), widget/PendingIntent mutability, storage permissions.
- **Supply chain**: unpinned CI actions, `npm install` vs `npm ci`, scripts run during install, secrets exposed to pull-request builds, release assets overwritten without verification.

## Accessibility and input
- **WCAG 2.2 AA**: 1.4.3 contrast (4.5:1 text, 3:1 large/UI), 1.4.4 resize 200%, 1.4.10 reflow at 320 CSS px, 1.4.11 non-text contrast, 2.1.1 keyboard, 2.1.2 no keyboard trap, 2.4.3 focus order, 2.4.7 focus visible, 2.5.8 target size (24×24 minimum; 44×44 is the platform guidance on touch), 3.3.x error identification and suggestions, 4.1.2 name/role/value. axe finds only part of this: do the keyboard-only and screen-reader-name passes by hand.
- **Touch & keyboard**: on-screen keyboard must not cover the field being typed in; no hover-only functions; destructive actions confirmable or undoable.

## Game-data formats (RPG Maker MV/MZ and similar)
- The data files are the game's own: a tool that edits them must write back **exactly** the structure it read, change only translated strings, keep numeric/boolean/null values, keep array lengths, keep command codes and indents, and never emit invalid JSON. Round-trip an untouched game and diff it: any difference is a finding unless the format forces it.
- Text codes in messages (backslash sequences for colour, variables, names, icons, waits) are part of the string and must survive.

## Language (Ukrainian)
- Правопис 2019: апостроф (’ ʼ ' accepted forms, never ` ´ ‘), літери (no ы э ъ ё), «ґ», сполучники «і/й», «у/в», випадні голосні, чергування г/ж/з, к/ч/ц, х/ш/с, закінчення Д. і М. в іменників ІІ відміни (-у/-ові, -і), кличний відмінок. Homoglyph/mixed-script words, soft hyphens, zero-width characters and non-standard spaces are defects in a translation.
- A rule that flags correct text, or lets wrong text pass, is a defect. State your confidence honestly: you are not a dictionary.

## Visual and interaction (use as a rubric, not as a standard)
- Hierarchy: the primary action is findable in two seconds. Density: no region needs reading more than twice. Consistency: the same thing looks the same everywhere. States: empty, loading, error, full, long text, no network. Truncation: nothing that matters is cut without a way to see it. Affordance: clickable things look clickable and the result of a click is visible. Colour is never the only carrier of meaning.

## Performance
- 100 000 rows: first meaningful paint after opening, typing latency (< 100 ms to the next character), scrolling without long tasks (> 50 ms), memory growth after 1 000 edits, time to save. Measure with the browser's performance APIs and CDP throttling (CPU ×4 for a low-end phone), report numbers.
