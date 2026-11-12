---
name: ux-fundamentals
description: "Method for a from-the-basics critique of a product's interface: inventory every decision (screen, control, label, default, flow, mental-model choice) in an area, judge each one against first principles and the conventions of the user's profession, and propose a concrete alternative. Use for a fundamental UI/UX review that must not rely on the authors' explanations."
---

# Fundamental UI/UX critique

The question is not "is there a bug". It is **"why is it like this, and is that right?"** — for every decision a user meets, down to the vocabulary and the defaults. You judge as someone who has never been told the reasons, who knows the profession the product serves, and who is willing to say "this whole idea is wrong".

## Rules
1. **Fresh eyes first.** Start as a first-time user, black-box, in a real browser (`blind-persona-run/drive.mjs`). Do not read source code until step 5. Everything you conclude about intent comes from what the screen shows and how it behaves.
2. **No notes.** The authors' comments, README, plans and test names do not exist for you. A decision is judged by what it does for the user, not by what someone meant.
3. **Every decision, not the interesting ones.** Cover your whole area exhaustively: every region of the screen, every control (including icon-only ones, menus, context actions, keyboard shortcuts), every label and word, every default value, every state (empty, loading, error, full, selected, disabled), every message, every flow between screens. A decision you skipped is a gap you must list.
4. **Judge from the user's job, not from the screen.** First write down (in `RUN/decisions/<area>-context.md` or in the register header) who the user is and what jobs they do in your area, in your own words, from what you observe and from your knowledge of the profession (translators of software/game text: segments, translation memory, termbase/glossary, QA checks, review/approval, context, deadlines, collaboration, file formats). Then every verdict is relative to those jobs and their frequency.
5. **Completeness check from code (only after the walkthrough).** You may now read `CLEAN/app/src` (comment-free) to look for screens, controls, states and shortcuts you did not reach. Anything found only this way is flagged `found_in_code_only: true`: that itself is a finding about discoverability. Do not use code to explain intent.

## The register of decisions
Write one JSON file per area: `RUN/decisions/<area>.json`, an array of entries:
```json
{
  "id": "A-014",
  "where": "screen / region / control, concretely",
  "decision": "what the product does or chooses here, one sentence (e.g. 'three view modes Таблиця / Редагування / Сцена as equal tabs in the top bar')",
  "inferred_purpose": "what problem it presumably solves for which user job",
  "verdict": "keep | adjust | rethink | remove | missing",
  "reasoning": "3-8 sentences: the argument from first principles, with the user's job in it. Concrete, not 'could be clearer'",
  "principles": ["names of the principles/heuristics used, e.g. 'Nielsen 1 visibility of system status', 'Hick's law', 'recognition over recall', 'Fitts', 'progressive disclosure', 'WCAG 2.5.8', 'platform guideline (Material 3 / Apple HIG)'"],
  "precedent": "how established tools in the same profession or platform handle it (Crowdin, Weblate, memoQ, Trados, OmegaT, Lokalise, Transifex, Poedit; or the platform's guidelines), with your confidence; say 'none known' if you do not know",
  "alternative": "a concrete alternative design: what the user would see and do instead (not 'improve it')",
  "affects": "who is hurt/helped, how often, how badly",
  "cost": "low | medium | high   (cost to the user of leaving it as is)",
  "confidence": 0.0,
  "evidence": ["evidence/<area>/NNN-*.png", "..."],
  "found_in_code_only": false
}
```
Verdicts: **keep** (right, and you can say why), **adjust** (right idea, wrong execution: say what), **rethink** (the idea itself serves the user poorly: say what replaces it), **remove** (it should not exist), **missing** (a decision the product *failed to make*: something the user's job needs that is absent, with the evidence that the user looks for it). Use `keep` honestly: a register that is all complaints is as useless as one that is all praise.

## What to examine in every decision (the rubric)
- **Purpose and necessity.** Which job does it serve and how often? What would the user lose if it vanished? Could the product do it for them without asking?
- **Vocabulary and mental model.** Are the words the profession's words? Does the same word mean one thing everywhere? Do the product's states (e.g. draft / sent / approved) correspond to something the user can actually observe happening? Are there invented terms that need a manual?
- **Information architecture.** Where would the user look first? Is the thing in the place its frequency and importance deserve? Grouping, hierarchy, depth, what is permanently visible vs hidden.
- **Interaction cost.** Clicks, keystrokes, pointer distance, mode switches, modal interruptions, how much the user must remember between steps. Frequent actions must be cheap; rare destructive ones must be hard to do by accident.
- **Feedback, prevention, recovery.** Does the user always know what state things are in and what just happened? Can mistakes be prevented, noticed, undone? (Nielsen 1, 3, 5, 9.)
- **Consistency and standards.** Internal (same thing, same look and behaviour, on PC and on phone) and external (the profession's and the platform's conventions). Departures need a reason that serves the user.
- **Cognitive load.** Number of simultaneous elements, competing calls to action, defaults that force a decision, jargon, hidden state. Recognition over recall; progressive disclosure.
- **Visual design as communication.** Hierarchy, density, rhythm, affordance, state signalling, colour as the only carrier, contrast, readable sizes. Judge what it *communicates*, not whether it is pretty.
- **Context fit.** Desktop (long sessions, keyboard, many windows) versus phone (one hand, interruptions, small targets, on-screen keyboard, poor connectivity).
- **Trust.** Can the interface ever mislead the user about their own work (saved vs not saved, sent vs not, replaced vs not)? Anything that does is severe whatever its other merits.

## Premise check (end of your run, in your final message)
Step back from the register and answer, plainly: for this area, what is the product *trying* to be, is that the right shape for these users, and what would you design from scratch if you had the same constraints (no server, local data, two front-ends sharing a core)? Name the three decisions you would reverse first and the three you would protect.

## Findings
Most register entries are not findings. File a finding (see `finding-format`) only when a decision demonstrably costs users something and you can show it: oracle = the principle or convention, repro = the screenshot sequence, severity `ux` or `visual` (or `functional`/`data-loss` if the interface misleads about the user's own work). Cross-reference the register id in the finding's `location` field.

## Output
- `evidence/<area>/NNN-*.png` (+ `.aria.txt` from `drive.mjs`), at least one per register entry that is not a pure `keep`.
- `decisions/<area>.json` as above: write entries as you go, not at the end.
- `findings/ux-NN.json` for the demonstrated costs.
- Final message: counts per verdict, the register's ten most expensive entries (id + one line), the premise check, what you did not cover and why, and the usual summary.
