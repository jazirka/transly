---
name: cleanroom
description: Build a notes-free copy of the repository (no comments, no Markdown, no tests, no history), build it, serve it, and generate independent test games, so a blind audit judges the product and not the authors' explanations.
---

# Clean room

Why: an auditor who reads the authors' comments, README, plan or tests inherits their reasoning and ends up confirming it. The clean room removes those notes so the auditor has to decide from the behaviour and the code alone.

## Build it
```
node .claude/skills/cleanroom/make-cleanroom.mjs <repo-root> <audit>/cleanroom
node .claude/skills/cleanroom/make-fixtures.mjs <audit>/fixtures
```
`make-cleanroom.mjs` takes the **committed** tree (no history), keeps `app/` and `.github/`, deletes all Markdown, mock-ups, tests and README/CHANGELOG-like files, and blanks every comment while keeping every line and column (so `path:line` in a finding is true in the original too). It writes `<audit>/<out-dir-name>-report.json` (so a second copy, e.g. the one that keeps tests, does not overwrite the first report).

It then **proves** the cleaning and exits non-zero otherwise:
- re-parses every TS/JS file and counts remaining comment tokens (must be 0),
- takes a random sample of up to 600 of the original comments (≥ 35 chars) and searches the clean room for them (should find none; investigate any hit — it may be the same phrase in a string).

## Then
```
cd <audit>/cleanroom/app && npm ci --no-audit --no-fund
npx vite build && npx vite build --mode mobile        # builds both front-ends (app/dist, app/dist-mobile)
npx vite preview --port 4275 --strictPort &            # the desktop front-end
npx vite preview --mode mobile --outDir dist-mobile --port 4274 --strictPort &   # the phone front-end
```
(Use other ports for the canary copy.) A type-check (`npx tsc --noEmit`) is a quick proof the stripped code still compiles.

## Rules for auditors working in it
- Work only inside the clean room, the fixtures and your own output directory. Do not read the original repository, its git history, its Markdown, or any scratch notes. If you do see a note by accident, record it under `contamination` in the finding.
- Strings that the user sees in the interface remain: that is part of the product.
- Fixtures are independent of the project: `clean-game` (an ordinary small game), `hostile-game` (hostile strings and malformed structures), `big-game` (~100 000 message lines). Generate your own as well; do not assume the three above are enough.
