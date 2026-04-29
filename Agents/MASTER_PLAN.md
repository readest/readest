# Citadel — Master Plan

## Current project status

Citadel has pivoted from the old Electron/EpubReader prototype to a **Readest fork**.

Current app root:

```txt
C:\Users\Eddy\Documents\citadel-app
```

Primary app:

```txt
apps/readest-app
```

Stack:

- Tauri 2 desktop shell
- Next.js / React / TypeScript frontend
- Rust/Tauri native layer
- Readest/Foliate reader foundation

The old Electron/EPUB.js implementation is now **legacy reference only**.

## Current operating model

- Active implementation agent: **Codex by default**, unless Eddy explicitly assigns Cursor or another agent for a specific task.
- Historical “Cursor” wording in agent docs means the currently assigned code agent when Codex is doing the work.
- ChatGPT is used for planning/review/debug prompts.
- Agents should work from `Agents/TASK_QUEUE.md` or from explicit one-off scoped prompts.
- Known generated/Tauri/plugin dirt should be auto-cleaned once before blocking a task, using the targeted cleanup rule in `Agents/DEVELOPMENT_RULES.md`.

## Global safety principles

- Preserve Readest behavior first.
- Make small, testable changes.
- Keep visual/UI work phased and manually verified.
- Do not port old Electron files directly.
- Do not touch reader core unless the task explicitly names it.
- Do not run broad rewrites, package upgrades, or dependency additions without approval.
- Do not clean or revert unrelated app/docs/agent files unless the task explicitly asks for it.

## Phase 0 — Baseline and workflow setup

- [x] Readest fork selected as Citadel base.
- [x] Local dev environment can run `pnpm.cmd tauri dev`.
- [x] Architecture audit created at `docs/CITADEL_ARCHITECTURE_AUDIT.md`.
- [x] Audit branch pushed to GitHub.
- [x] Git credential helper fixed from `manager-core` to `manager`.
- [x] Dev launcher `.bat` approach selected instead of installing Program Files build.
- [x] Known generated/Tauri/plugin dirt auto-clean rule added to workflow docs.
- [>] Agent workflow/rules update for Readest project.

## Phase 1 — Design handoff triage

Goal: understand the Claude design handoff without implementing it blindly.

- [ ] Add/update `Agents/DESIGN_HANDOFF_NOTES.md`.
- [ ] Document which handoff files are usable in Readest now.
- [ ] Document which handoff files are old Electron-only reference.
- [ ] Document safe implementation sequence.
- [ ] Add asset inventory for logo/comet/color tokens.

## Phase 2 — Assets only

Goal: add Citadel assets without changing UI behavior.

- [x] Copy `citadel-logo.png` and `comet.png` into the correct Readest public/static asset location.
- [x] Confirm files load in dev server.
- [x] Do not change UI in the asset-only task.
- [x] Log exact destination paths.

## Phase 3 — Design tokens only

Goal: introduce Citadel visual constants safely.

- [x] Locate current global styles/theme entry points.
- [x] Add Citadel color/type tokens without applying them broadly.
- [x] No layout changes.
- [x] No reader behavior changes.

## Phase 4 — Safe branding pass

Goal: change visible identity from Readest to Citadel in low-risk surfaces.

- [x] App/window title.
- [x] Metadata/title strings.
- [x] Safe visible labels only.
- [ ] Leave package IDs/build IDs alone unless explicitly approved.
- [~] Run dev app and request visual verification.

## Phase 5 — Topbar/header polish

Goal: adapt the Citadel topbar style to existing Readest shell.

- [x] Inspect existing header/topbar components.
- [~] Apply minimal styling changes.
- [x] Keep navigation behavior unchanged.
- [~] Human visual verification required.

## Phase 6 — Library/home visual pass

Goal: adapt hero/shelf/book-card ideas using real Readest data.

- [x] Identify library/home components.
- [~] Apply one small visual improvement at a time.
- [x] Do not replace data flow.
- [~] Human visual verification required after each visual slice.

## Phase 7 — Reader chrome polish

Goal: polish reader controls without touching rendering/sync internals.

- [ ] Identify safe reader chrome components.
- [ ] Avoid Foliate renderer internals.
- [ ] Avoid readerStore behavior changes unless explicitly approved.
- [ ] Human visual verification required.

## Phase 8 — Companion features / lore layer

Goal: later port useful character/sidebar concepts into Readest properly.

- [ ] Re-audit Readest sidebar/panel architecture first.
- [ ] Define new data shape for characters/notes before UI.
- [ ] Do not paste old Electron character sidebar.
- [ ] Build behind feature flag or isolated panel.

## Phase 9 — Audiobook and sync layer

Goal: later reintroduce audiobook/text-sync features in the Readest architecture.

- [ ] Re-audit current TTS/audio/media session code.
- [ ] Define audiobook player integration boundary.
- [ ] Define sync-map storage and book metadata boundary.
- [ ] Implement only after branding/design foundation is stable.

## Legacy archive

The old Electron/EPUB.js audit history is preserved in:

```txt
Agents/LEGACY_ELECTRON_AUDIT_LOG.md
```

Do not treat those old entries as current completed work for the Readest app.
