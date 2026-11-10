---
name: finding-format
description: The only accepted shape of an audit finding, and the rules that make a finding admissible (external oracle, reproduction, no reliance on the authors' notes). Read before reporting anything in a teardown audit.
---

# Finding format

A finding is a **claim that the product is wrong**, backed by something anyone can re-run. If it cannot be re-run, it does not exist.

## Admissibility (all four, or it is discarded)
1. **External oracle.** Say what makes it wrong *outside this codebase*: a standard (WCAG 2.2 criterion, OWASP item, Tauri/Android documentation), a mathematical law (commutativity, idempotence, round trip), a file-format fact (the real structure of the data the product reads), a language norm (Ukrainian orthography), a platform rule, or plain observable harm (data lost, text unreadable). "The code is inconsistent with itself" is allowed only when you show one of the two behaviours is harmful by an external oracle.
2. **Reproduction.** A failing test, a script, or a screenshot sequence, stored under the run's `evidence/` directory, with the exact command to re-run. A reader who has never seen your reasoning must be able to run it and see the failure.
3. **No reliance on notes.** You did not use comments, READMEs, plans, commit messages, test names or any statement of intent by the authors as evidence that something is "intended" or "wrong". Behaviour is judged against the oracle, not against what the authors say they meant. If you stumble on such a note, say so in `contamination` and do not let it influence the verdict.
4. **Specific.** One defect per finding, with the smallest input that triggers it.

## File: `findings/<lens>-<nn>.json`
```json
{
  "id": "data-03",
  "lens": "data-integrity",
  "title": "short, concrete",
  "claim": "what is wrong, in one or two sentences (Ukrainian)",
  "severity": "data-loss | security | functional | ux | visual | maintainability",
  "oracle": "the external standard/law/fact that says it is wrong",
  "expected": "what the oracle requires",
  "actual": "what happens",
  "repro": { "kind": "test | script | screenshots", "command": "how to re-run from the clean-room root", "path": "evidence/..." },
  "evidence": ["evidence/..."],
  "location": "path:line in the clean room, or 'black-box'",
  "minimal_input": "the smallest input or sequence of steps",
  "confidence": 0.0,
  "impact": "who is hurt and how (Ukrainian)",
  "contamination": "none | what note you saw and how you kept it out of the verdict"
}
```
Severity guide: **data-loss** = user work silently lost or corrupted; **security** = a hostile file/project/server can read, write or run something it should not; **functional** = a feature gives a wrong result; **ux** = a competent user is slowed, misled or stuck; **visual** = something is clipped, overlapped, unreadable or misleading on screen; **maintainability** = a structural defect that will cause the above later.

## Also write `SUMMARY-<lens>.md`
- What you examined (concretely: files, flows, inputs, viewports).
- What you did **not** examine, and why.
- Hypotheses you tried to confirm and could not (negative results are results).
- Anything that looked wrong but you could not prove (these are *not* findings).

Write in Ukrainian for `claim`, `impact`, summaries; keep code, paths, selectors and quotes verbatim.
