# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one `CONTEXT.md` and one `docs/adr/` at the root.

## Before exploring, read these

- **`PIDE.md`** at the repo root, the living architecture doc, always.
- **`CONTEXT.md`** at the repo root, the domain glossary.
- **`docs/adr/`**, the ADRs that touch the area you are about to work in.

If any of these files do not exist, **proceed silently**. Do not flag their absence; do not suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── PIDE.md
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-....md
│   │   └── 0002-....md
│   └── architecture/
├── src/
└── src-tauri/
```

`docs/architecture/` holds long-form subsystem write-ups. ADRs record the decision and its alternatives; architecture docs describe how the subsystem works today. When they disagree, the ADR is the record of intent.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, that is a signal: either you are inventing language the project does not use (reconsider), or there is a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because..._
