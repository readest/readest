# Citadel — Design Handoff Notes

## Purpose

This file translates the Claude design handoff into a safe implementation plan for the current Readest/Tauri app.

The handoff is useful as a **visual direction**, but it was created against the previous app assumptions. Do not implement it blindly.

## Safe to use early

- `project/assets/citadel-logo.png` (design package; not always present under `Agents/handoff/`)
- `project/assets/comet.png` (same)
- `project/colors_and_type.css`
- preview files for colors, spacing, shadows, topbar, shelf tile, and tilt card
- visual principles: dark editorial UI, warm gold accent, parchment/fantasy mode as optional layer

## Reference only / adapt carefully

- `project/ui_kits/citadel/*.jsx`
  - useful for component ideas
  - not wired to Readest state/data
  - should not be pasted directly into production
- `project/Citadel App.html`
  - useful as a prototype preview
  - not production code
- `project/preview/*.html`
  - useful for design review
  - not production code

## Old-project-only handoff files

These were aimed at the old Electron/vanilla implementation and should not be pasted into Readest:

- `project/handoff/fantasy-mode.css`
- `project/handoff/citadel-snippets.html`
- old character/sidebar HTML snippets
- old audiobook/speaking-now markup
- old CSS selectors targeting prior DOM structure

They can be mined later for design language only.

## Readest implementation order

1. Notes and inventory only.
2. Copy assets only.
3. Add isolated Citadel tokens only.
4. Safe visible branding.
5. Topbar/header polish.
6. Library/home polish.
7. Reader chrome polish.
8. Companion/sidebar features.
9. Audiobook/sync-specific UI.

## First safe code task

Copy the logo/comet assets into the Readest app public/static asset location without referencing them in UI yet.

**Canonical Readest paths (TASK-001 / CT-002) — intended targets only:**

- On disk: `apps/readest-app/public/citadel/citadel-logo.png`, `apps/readest-app/public/citadel/comet.png`
- Served URL: `/citadel/citadel-logo.png`, `/citadel/comet.png`

**These files are not in the repo today.** Do not use placeholder images. When the real design exports are available, copy them into the paths above (creating `public/citadel/` as needed), then proceed to UI wiring. Until then, CT-002 remains blocked for lack of source assets in handoff.

## Hard rule

Do not use this prompt directly:

```txt
Fetch this design file, read its readme, and implement the relevant aspects of the design...
```

That is too broad for this codebase. Every design step must be split into a small task with allowed files and validation.
