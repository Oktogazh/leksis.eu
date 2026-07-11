# Design note: Language selection (the language-scope selector)

**Status:** Draft — requirements gathering, no decision yet
**Date:** 2026-07-07
**For:** Week 3 (Loop 1: Languages) — the language-selector half of the search bar
**Related:** `languages` collection (leksis context skill); i18n (`react-i18next`, `apps/web/src/i18n/`); inert search shell in `apps/web/src/pages/HomePage.tsx`
**Supersedes into:** an ADR once the open questions below are decided

> This note captures *what the language selector must do* and the *questions that must
> be answered before building it*. It deliberately does **not** decide the solution —
> that is the next session's job (start here, then hand the chosen approach to the
> `planner` agent). Written because what looks like "a dropdown" fans out into several
> coupled sub-problems that would otherwise get hard-coded away.

---

## 1. Context — two different "language lists"

The single most important distinction to hold onto: there are **two** lists, and they are
not the same thing.

| | The **reference universe** | The **`languages` collection** |
|---|---|---|
| What | Every *selectable* language code (IETF language subtags (ISO 639-2/3) + IETF subtags for dialects) | Languages that actually have content in Leksis |
| Role | Reference data the selector offers | Live graph data created in Loop 1 |
| Shape today | Does not exist yet | `{ _key: IETFTag, name: string, createdAt }` |
| Who writes it | TBD (see open questions) | Any logged-in user, in Loop 1 |

The selector lets a user pick a code from the **reference universe** in order to
create/scope into the **`languages` collection**. Conflating the two is the trap.

---

## 2. Functional requirements

- **R1 — A future-proof code set.** The universe covers IETF language tags, so any language (including low-resource ones) is selectable from day one — this is the project's "universal from the start" principle, not a nice-to-have. But the tag list may be extended over time (new dialects, new subtags), so list must be on a separate file in the beginning, then it will be replaced by entries in the database.
- **R2 — Localised names.** A language's display name must render in the *interface* language (react-i18next locale). "German" in an English UI, "Allemand" in a French UI.
  Note the schema gap: `languages.name` is a single string today — insufficient for
  localised names.
- **R3 — Dialects.** The system must represent dialects, not just macrolanguages. The
  entry-key convention already uses extended IETF tags (`br-gw` = Vannetais Breton), so
  dialects are anticipated via IETF subtags rather than raw ISO 639-3.
- **R4 — Extensible list.** Because dialects (and other subtags) will be added over time,
  the universe cannot be a frozen hard-coded frontend array — it needs a path to grow.
- **R5 — Editing criterion.** If the list is editable, *who* may add a language/dialect,
  and on *what* criterion? This is a governance question, not just a technical one, and
  it foreshadows the future weighted-voting mechanism.
- **R6 — Shortlist.** To ease UX, the selector surfaces a shortlist of the user's
  previously-selected languages first, before the full universe.
- **R7 — Shortlist updates on use.** Selecting a language adds/promotes it in the
  shortlist, so frequently-used languages stay at hand.
- **R8 — Browse the full list.** Beyond the shortlist, the user can browse/search the
  whole universe by **code** (e.g. `bre`) *or* by **localised name** (e.g. "Breton").

---

## 3. Open questions to resolve next session

- **Q1 — Fixed list now, editable system later?** Proposed: Phase 1 ships a bundled,
  read-only ISO 639-3 snapshot; the editable/governed system (R4/R5) is deferred with a
  trigger. Confirm this phasing before building — it keeps Loop 1 to its smallest slice.
- **Q2 — Where does the reference universe live?** Bundled static asset in `apps/web`? a
  `languageRegistry` collection in ArangoDB? records on a PDS? Trade-off: bundled is
  simplest but least decentralised; Arango/PDS aligns with "decentralised & owned" but is
  heavier for Loop 1.
- **Q3 — Source of localised names (R2).** CLDR data? a bundled name table? community
  translation? Low-resource language *names* may themselves lack translations into the
  interface language — how is the fallback handled (show the endonym? the code?).
- **Q4 — Dialect modelling (R3).** Standardise on IETF extended/private-use subtags
  (leaning on the existing `br-gw` convention), and define how a dialect points to its
  parent macrolanguage.
- **Q5 — Editing governance (R5).** Centralised AppView curation vs decentralised
  proposals on PDS vs the future voting mechanism. Likely deferred, but name the intended
  end-state so Phase 1 doesn't foreclose it.
- **Q6 — Shortlist storage (R6/R7).** `localStorage` (simplest) vs the user's PDS
  (aligns with decentralisation) vs an Arango per-DID record. Decentralised principle
  favours PDS, but localStorage is the smallest Loop-1 slice.
- **Q7 — Schema change (R2/R3).** `languages` today is `{ _key: IETFTag, name: string,
  createdAt }`. Localised names + dialect→parent links need more fields. Treat as a
  deliberate `packages/types` + ArangoDB + lexicon change when built (types are the
  contract).

---

## 4. Alignment with project principles

- **Universal from the start** — R1 is non-negotiable: any language selectable, nothing
  hardcoded to one language family.
- **Decentralised & owned** — pushes Q2 and Q6 toward the PDS rather than the platform;
  weigh against Loop-1 simplicity.
- **Consensus-ready** — R5's editing criterion is itself a future voting surface; keep
  version history if the registry becomes editable (archive, don't delete).
- **Smallest slice** — Loop 1 should ship the *thinnest* selector that satisfies R1/R6/R7/R8
  over a fixed universe; R4/R5 (editable, governed) are a later loop with a trigger.

---

## 5. Proposed phasing (to validate, then plan)

- **Phase 1 — Loop 1 (Week 3):** bundled read-only ISO 639-3 registry; selector with
  search by code and by localised name (R1, R8); `localStorage` shortlist (R6, R7).
  Universe is fixed. This is the buildable slice.
- **Phase 2 — later loop (trigger: dialects/community editing actually needed):**
  dialects via IETF subtags (R3), extensible + governed registry (R4, R5), name
  localisation source finalised (R2), shortlist possibly moved to PDS (Q6).

---

## 6. Next session — pick up here

1. Decide **Q1** (phasing), **Q2** (registry home), **Q3** (name source) — the three that
   unblock Phase 1.
2. Record the decisions as an **ADR** (this note supersedes into it).
3. Hand the Phase-1 slice to the **`planner`** agent for the implementation plan
   (lexicon slice → api → AQL → types → web), per the loop template.
