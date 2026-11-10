---
name: visual-matrix
description: Capture a matrix of screenshots (viewport x colour scheme x app state) with mechanical layout checks, then critique the images against an external rubric as a designer would, naming what would confuse or tire a user.
---

# Visual matrix and critique

Two layers. **Mechanical** (a script, no opinion): overflow, text clipped without a way to read it, controls smaller than the platform minimum, controls overlapping, controls with no accessible name, tiny text, contrast and target-size violations. **Critical** (a looking pass, opinion with evidence): hierarchy, density, consistency, states, truncation, affordance, colour-as-only-signal.

## Build the matrix
1. Explore the app black-box (see `blind-persona-run`) to learn how to reach each state; list the states worth capturing: empty/first run, a normal loaded view, a long-text view, a busy/loading view, an error view, each dialog, each tool screen, selection/bulk mode, a hostile-data view.
2. Write `setup.mjs` (`export default async (page, state, { vp, scheme }) => {...}`) that brings a fresh page to each named state through the app's own controls.
3. Write a config and run it:
```
node <method>/visual-matrix/matrix.mjs <run>/matrix.json
```
Viewports to include at least: desktop 1400×900, narrow desktop 1000×700, a phone in portrait and landscape (`device: "Pixel 7"` and a landscape variant `{ "name": "phone-land", "width": 915, "height": 412, "touch": true }`). Schemes: `dark` and `light`. Optionally pass `axe` (path to `axe.min.js`; `npm i axe-core` in your run directory) for contrast/target-size rules.

## Critique (you look at every image, not at the JSON only)
Read each screenshot. For each, answer against the rubric:
- **Hierarchy:** can I tell in two seconds what this screen is for and what the main action is?
- **Density and rhythm:** is any region crowded, any region empty for no reason, is spacing consistent?
- **Alignment and consistency:** do equal things look equal (buttons, chips, headers, spacing, icon style, wording)? Are there two different ways of doing the same visual thing?
- **States:** is each state (empty, loading, error, long, many) designed, or does it look accidental?
- **Truncation:** is anything that matters cut off with no way to read it?
- **Affordance and feedback:** do clickable things look clickable; is the result of an action visible?
- **Colour:** is anything conveyed by colour alone; does anything vanish in light mode (or dark mode) that looked fine in the other?
- **Reading:** is text comfortably readable at its size and contrast, in Ukrainian, with long words?
Then compare cells: what differs between dark/light, desktop/narrow/phone that should not?

## Output
- `matrix/*.png`, `matrix/matrix-index.json`.
- Findings per `finding-format`: mechanical findings cite the matrix cell and the check output; critical findings cite the screenshot and say **what you see** and **who it would trouble and how**. Mark critical findings `confidence` honestly: taste is not proof — say "would confuse a first-time user" rather than "is wrong" unless a standard says so.
- `SUMMARY-visual.md` with a table: screen × viewport → verdict (fine / issues), and the top ten issues by impact.
