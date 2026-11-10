---
name: teardown
description: "Orchestrate a notes-free, adversarial audit of a project from its foundations: clean room, canary calibration, parallel hostile lenses, independent reproduction, and an unsoftened report. Use when asked to tear a project apart, audit it without trusting its notes, or check how good the verification really is."
---

# Teardown audit

The orchestrator (you) is contaminated: you may have written the code and you know the authors' reasons. So you **dispatch, collect and report; you do not judge.** Judgement is done by notes-free auditors and by independent reproduction.

## Layout (`AUDIT` = a directory outside the repository, e.g. the session scratchpad `/audit`)
```
AUDIT/cleanroom/        notes-free copy, built       (ports PC 4275, phone 4274)
AUDIT/cleanroom-tests/  same, but keeps tests        (only for cr-test-skeptic; build not needed)
AUDIT/fixtures/         clean-game, hostile-game, big-game
AUDIT/method/           copy of .claude/skills and .claude/agents (auditors read this, not the repo)
AUDIT/canary/           a copy with planted defects + the secret answer list (ports PC 4375, phone 4374)
AUDIT/runs/<id>/        findings/, adjudication/, evidence/, SUMMARY-*.md, ledger.json, LEDGER.md, REPORT.md
```

## Steps
1. **Prepare.** `make-cleanroom.mjs` (see `cleanroom`) must exit 0. `npm ci`, install audit tools (`npm i --no-save fast-check axe-core` inside `cleanroom/app`), build both front-ends, start both servers, generate fixtures, copy the method files: `cp -r .claude/skills .claude/agents AUDIT/method/`. Smoke-test: load `PC_URL` and `PHONE_URL`, open `fixtures/clean-game/data` through the UI.
2. **Calibrate with canaries.** In `AUDIT/canary/` (a separate copy of the clean room, built and served on its own ports) plant about a dozen known defects spanning the lenses (data-law violation, lost tombstone, unescaped HTML sink, path check removed in a native command, clipped label, low-contrast colour, lost-write on shutdown, wrong undo, token in a URL, tiny touch target, missing accessible name, a stale-cache bug). Keep the answer list **in a file auditors never see**. Run the lenses against the canary copy exactly as they will run on the real one; the share of canaries found (and whether each finding names the right cause) is the audit's measured sensitivity. A lens that misses its canaries is rewritten before it is trusted. Also record every finding on the canary copy that is *not* a canary (those are either real problems in the product, which count, or false positives, which lower the lens's precision).
3. **Wave 1 (parallel, up to 4 agents at once).** Spawn each lens with the Agent tool using a **fresh** agent (not a fork of this conversation), the model set in its definition, and a prompt of this shape:
   > Your role definition is the file `METHOD/agents/<lens>.md`: read it completely and follow it. METHOD=`AUDIT/method`, CLEAN=`AUDIT/cleanroom`, FIXTURES=`AUDIT/fixtures`, RUN=`AUDIT/runs/<id>/<lens>`, PC_URL=`http://localhost:4275/`, PHONE_URL=`http://localhost:4274/`. <persona and goal for blind users>
   Wave 1: `cr-data-integrity`, `cr-security`, `cr-visual-critic`, and `cr-blind-user` ×N personas (first-timer; power user on keyboard; phone user in motion; low-vision/colour-blind user; careless or hostile user). Run mechanical tools in parallel yourself (they need no judgement).
4. **Adjudicate.** For every admissible finding, spawn `cr-adjudicator` (fresh, a different model from the finder where practical). Batch small ones. Run `node AUDIT/method/skills/teardown/ledger.mjs RUN` to merge; inadmissible findings (no oracle/repro) stay visible in the ledger but are marked as such.
5. **Wave 2** by what wave 1 showed: `cr-foundation`, `cr-perf-chaos`, `cr-linguist`, `cr-a11y-input`, `cr-platform-reality`, `cr-test-skeptic` (with `CLEAN_TESTS=AUDIT/cleanroom-tests`). Adjudicate their findings the same way.
6. **Report** (`RUN/REPORT.md`, Ukrainian), in this order, nothing softened or removed:
   1. Method and its limits (what was and was not simulated; same model family; instruction-level, not technical, isolation of the auditors).
   2. Calibration result (canaries: planted / found / right cause; false positives per lens).
   3. Reproduced findings, by severity, each with oracle, reproduction command and evidence path.
   4. **Decisions in doubt:** findings that contradict a decision the project owner made earlier, stated neutrally; the owner decides.
   5. Findings not reproduced / flaky / oracle-invalid (so the owner can see what was rejected and why).
   6. Not examined, and the real-device checklist (`real-device-protocol` plus `PLATFORM-CHECKLIST.md`).
   7. **Orchestrator's disagreements**, clearly separated, never replacing an auditor's verdict.
   Show screenshots with the findings (send them or publish the report), never summarise a severe finding into a vaguer one.

## Rules for the orchestrator
- Do not edit the product during the audit. Fixes come after the owner reads the report, and a fix that reverses an owner decision needs the owner's word.
- Do not give auditors anything outside their lens file and the variables. In particular, no summary of what the product is "supposed" to do beyond what is visible in it.
- Auditors are not technically sandboxed; isolation is by instruction. Spot-check: grep their transcripts/commands for paths outside `AUDIT` and note any breach under limits in the report.
- Never publish secrets that an auditor may find in fixtures or code; replace with `<redacted>` in reports.
- Keep each run reproducible: record commit, clean-room report, tool versions, models used.
