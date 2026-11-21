---
description: Update the plain-language system docs in docs/system_docs (architecture, flows, Mermaid diagrams)
argument-hint: [optional focus, e.g. "the webhook changes"]
---

Document what you did. Focus (may be empty, meaning everything that changed): $ARGUMENTS

Goal: someone who has just opened this repo reads `docs/system_docs/` and fully understands the system (what it does, its architecture, its design, and how the parts work together) without reading the code. Write for a smart non-specialist: plain words, short sentences, a concrete example for every abstract idea, and every jargon term explained on first use (or linked to the glossary in `01-overview.md`).

Steps:

1. **Find what changed.** Read `docs/system_docs/CHANGELOG.md` and note the last documented commit. Run `git log --oneline <that-commit>..HEAD` and `git diff --stat <that-commit>..HEAD` (on a first run, use the whole history). Read the changed code, migrations, ADRs and `CLAUDE.md`. If the focus above is set, go deeper there, but still keep the other docs accurate.
2. **Verify, don't recall.** Every claim (table names, endpoints, states, retry numbers, file paths, commands) must match the current code. Check it. If the docs and the code disagree, the code wins: fix the docs.
3. **Update the existing files in place** (don't duplicate them). Keep the numbered structure:
   - `README.md` (start here: summary, reading order, map of the docs)
   - `01-overview.md` (problem, solution, scope, glossary)
   - `02-architecture.md`
   - `03-payment-flow.md`
   - `04-data-model.md`
   - `05-ledger.md`
   - `06-jobs-events-webhooks.md`
   - `07-api.md`
   - `08-security.md`
   - `09-running-and-testing.md`
   - `10-decisions-and-gaps.md`

   Add a new numbered file only for a genuinely new area, and link it from `README.md`.

4. **Diagrams: Mermaid only** (fenced ```mermaid blocks; they render on GitHub and in VS Code). Use the type that fits:
   - `flowchart` for architecture and flows
   - `sequenceDiagram` for interactions over time
   - `stateDiagram-v2` for lifecycles
   - `erDiagram` for tables
   - `classDiagram` for module and interface structure (UML)

   Keep labels short, quote labels that contain punctuation, and put a one-sentence "what this shows" line above every diagram. Update existing diagrams when behaviour changes.

5. **Append to `CHANGELOG.md`.** Add a dated entry (newest first) with:
   - the commit range documented
   - what changed, in plain terms
   - why it changed
   - which docs were updated
   - the last documented commit hash
6. **Don't commit.** `docs/system_docs` is gitignored on purpose; these docs are local. Don't touch code or ADRs while documenting.
7. **Finish with a short summary** in chat: which files changed and the 3–5 most important things a reader should now understand.
