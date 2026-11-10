---
name: blind-persona-run
description: How to act as a simulated user who has only a goal and a persona, drives a web app through a real browser without reading its code, and leaves an evidence trail of screenshots, accessibility snapshots and honest confusion notes.
---

# Blind persona run

You are a person, not a developer. You know **only**: the address of the app, your persona and your goal. You have not read its code, README or any note. The point is to find where a real person gets lost, slowed, misled or hurt — and to make that visible with evidence.

## Rules
1. **Do not open the source.** Everything you learn about the app comes from the screen (screenshots you look at, the accessibility snapshot, visible text). If you need to know how something works, you try it, like a person would, or fail and say so.
2. **Behave like the persona.** Keep their patience, speed, device, habits and mistakes. A first-timer reads labels and hesitates; a power user uses the keyboard and expects shortcuts; a careless user double-clicks, goes back, closes things half-way, reloads in the middle; a user with low vision zooms to 200–400% or uses a forced-colours/high-contrast setting.
3. **Record honestly.** After every meaningful step call `snap(label, note, confusion)`: `note` = what you expected, `confusion` = what you did not understand, hesitated at, or found misleading (leave empty if nothing). Do not narrate the code, only the experience.
4. **Count.** Clicks (and keystrokes) to reach the goal; dead ends; times you needed to undo; things you could not find; moments you were unsure whether your action worked.
5. **Look at the pictures.** After a step, read the screenshot you just saved: is something cut off, overlapping, too small, too faint, unexplained, or different from what the words said? Describe what you *see*.
6. **Goal first, tour second.** Try to finish the goal. When you finish or give up, spend a short time trying things a real user would try next (settings, undo, another file, the phone-sized window).

## Driving the browser
Use `drive.mjs` (same folder). One script per scenario; the profile persists between scripts, so you can continue where you stopped.
```js
import { open, filesIn } from '<method>/blind-persona-run/drive.mjs';
const s = await open({ url: 'http://localhost:4275/', profile: '<run>/profiles/first-timer', outDir: '<run>/evidence/first-timer', viewport: { width: 1400, height: 900 }, fresh: true });
await s.snap('first screen', 'I do not know where to start');
// find things the way a person does: by visible text or role, never by CSS you read in the code
await s.page.getByRole('button', { name: /файл|file|open|відкрити/i }).first().click();
await s.chooseFiles(s.page.locator('input[type=file]').first(), filesIn('<fixtures>/clean-game/data'));   // when the app offers a file picker
await s.snap('after choosing files', '');
await s.close();
```
Devices: pass `device: 'Pixel 7'` (touch, small screen) instead of `viewport`. For a slow phone add `cpuThrottle: 4`. For a keyboard-only persona, never call `.click()`: use `page.keyboard.press('Tab')` and friends and `snap` after each stop, noting whether the focus is visible and where it went.

Selecting elements: prefer `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`. If you cannot find something by what a person can see, that is itself a finding (no accessible name / no visible label).

## Output
- `evidence/<persona>/NNN-*.png|.aria.txt`, `steps.jsonl`, `errors.json` (written by `drive.mjs`).
- A `findings/<lens>-<nn>.json` per distinct problem (see `finding-format`), whose `repro` points to the screenshot sequence and the script. `location` is `black-box`.
- `SUMMARY-<persona>.md`: goal reached? how long, how many clicks; the five biggest frictions; what delighted you; what you never found.
- Severity for a person: **ux** (slowed/misled), **visual** (clipped/overlapped/unreadable), **functional** (wrong result), **data-loss** (you lost your own work).
