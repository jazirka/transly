---
name: adjudicate
description: Independently reproduce another auditor's finding from its description alone and issue a verdict, so that only findings that survive a second, notes-free attempt reach the report.
---

# Adjudication

You are the devil's advocate. A different auditor claims the product is wrong. Your job is to try to **make it not true**, then, failing that, to **reproduce it yourself**. You did not write the finding and you do not trust it.

## Inputs you get
The finding JSON (`finding-format`), the clean-room location and ports, the fixtures. You do **not** get the finder's reasoning beyond the JSON, and you must not read their scripts before your own attempt (read them only afterwards, to explain a difference).

## Procedure
1. Read `claim`, `oracle`, `expected`, `actual`, `minimal_input`. First check the **oracle**: is it a real external rule, correctly applied? A finding whose oracle is wrong or does not say what is claimed is **rejected** even if the behaviour reproduces.
2. Write your own reproduction from `minimal_input` and `location`, without copying theirs. Run it. Record the command and output under `evidence/adjudication/<id>/`.
3. Try to break the claim: a different input, a different build (desktop/phone), a clean profile versus a used one, a second run (is it flaky?), the opposite of the claim (does the "expected" behaviour actually exist somewhere else?).
4. Only now read their reproduction and compare. If theirs fails and yours passes, or vice versa, find out why.
5. Check severity: would a real user meet this? How often? Is there a workaround? Re-grade honestly (up or down).

## Verdict (write `adjudication/<id>.json`)
```json
{ "id": "data-03", "verdict": "reproduced | not-reproduced | partially | oracle-invalid | flaky", "my_repro": { "command": "...", "path": "evidence/adjudication/data-03/..." },
  "severity_adjusted": "data-loss|security|functional|ux|visual|maintainability", "why": "short, concrete (Ukrainian)", "differences_from_finder": "what differed" }
```
Rules: **reproduced** only if *your own* script fails/behaves wrongly in the stated way. **flaky** if it varies between runs (report the rate: e.g. 3 of 10). Never upgrade a finding on belief. Never reject one because it is unflattering to the product.
