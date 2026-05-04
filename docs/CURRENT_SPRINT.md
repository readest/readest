# Citadel Current Sprint

> Update this file at the start of each sprint or when work shifts.
> Agents: check this before starting any task.

---

## Active Branches

| Branch                            | Agent          | Task                                                   | Status      | Risk   | Ownership Area                                 |
| --------------------------------- | -------------- | ------------------------------------------------------ | ----------- | ------ | ---------------------------------------------- |
| `wip/combined-agent-output`       | Audiobook Sync | Gap-fill sync map, proactive relocation, debug logging | In progress | Medium | Audiobook Sync + coordination with Reader Core |
| `citadel/ui-reader-visual-polish` | UI Visual      | Reader frame styling, chapter ornaments, drop caps     | Planned     | Low    | UI Visual + coordination with Reader Core      |
| `citadel/infra-validation-docs`   | Infra QA       | Multi-agent workflow docs and validation script        | In progress | Low    | Infra QA                                       |

---

## Do Not Touch Right Now

These areas have active work in progress. Avoid editing unless your task specifically targets them:

- `useAudiobookPlayer.ts` — active debug instrumentation on `wip/combined-agent-output`
- `FoliateViewer.tsx` — CSS and ornament injection being tuned on `wip/combined-agent-output`
- `page.tsx` (homepage) — book frame redesign in progress
- Cargo.toml and Tauri permission files — CRLF normalization noise, do not commit unrelated changes

---

## Merge Order

When ready to land, merge in this order to minimize conflicts:

1. `citadel/infra-validation-docs` — docs and scripts, no feature code
2. `citadel/ui-reader-visual-polish` — visual-only, may need rebase after sync
3. `wip/combined-agent-output` — largest surface, lands last

---

## Current Known Issues

| Issue                                                                                      | Branch                      | Severity | Owner               |
| ------------------------------------------------------------------------------------------ | --------------------------- | -------- | ------------------- |
| Verbose debug logging in `useAudiobookPlayer.ts` — needs cleanup or gating                 | `wip/combined-agent-output` | Low      | Audiobook Sync      |
| 12 test files with pre-existing failures (TTS, shortcuts, updater, etc.) — browser API gap | `main`                      | Medium   | Infra QA            |
| Submodule dirty markers on `packages/tauri` and `packages/tauri-plugins`                   | `wip/combined-agent-output` | Low      | Needs investigation |
| CRLF warnings on Tauri permission files — no functional change                             | `wip/combined-agent-output` | None     | Ignore              |

---

## Manual QA Needed

These need a human (or gstack) to verify in the running Tauri app:

- [ ] Audiobook sync: highlight follows spoken word, page turns at section boundaries
- [ ] Audiobook sync: seek jumps highlight correctly
- [ ] Homepage featured book frame renders without clipping
- [ ] Reader page texture/ornaments visible on both light and dark backgrounds
- [ ] GOT chapter sigil size, position, and color match reference
- [ ] Drop cap renders with `initial-letter` where supported, float fallback elsewhere
- [ ] Reader resize/re-maximize preserves reading position
- [ ] Non-themed books still render correctly (no broken ornament injection)

---

## Recently Completed

| Branch | What | Landed |
| ------ | ---- | ------ |
| —      | —    | —      |

---

## Branch Naming Rules

**Good:**

- `citadel/ui-reader-frame-polish` — area + specific task
- `citadel/reader-resize-cfi-recovery` — area + bug description
- `citadel/audio-progressive-highlight-fix` — area + feature/bug
- `citadel/infra-biome-cleanup` — area + type of work

**Bad:**

- `fix-stuff` — too vague
- `new-feature` — not Citadel-specific
- `agent-work` — no area or task context
- `test` — could be anything

**Format:** `citadel/<area>-<specific-task>`

Areas: `ui`, `reader`, `audio`, `infra`, `sync`, `library`, `tauri`
