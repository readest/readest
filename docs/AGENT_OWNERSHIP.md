# Citadel Agent Ownership Map

Purpose: prevent conflicts when multiple agents work on the same codebase.
Always check this map before editing files outside your primary area.

---

## UI / Visual Design Agent

**Primary:**

- `apps/readest-app/src/app/**/components/**` — all UI components
- `apps/readest-app/src/components/**` — shared components
- `apps/readest-app/src/styles/**` — themes, textures, ornaments, design tokens
- `apps/readest-app/public/citadel/**` — brand assets, book art, ornaments, sigils
- Visual theme files (`globals.css`, `book-themes.ts`, `ornaments.ts`, `textures.ts`)

**Must coordinate before touching:**

- `FoliateViewer.tsx` — shared with Reader Core for injected styles/CSS
- `useAudiobookSync*.ts` / `useAudiobookPlayer.ts` — shared with Audiobook Sync for playback controls UI
- Data/state stores (`readerStore.ts`, `bookDataStore.ts`, `libraryStore.ts`)
- Transcript utilities (`audiobookTranscript.ts`, `transcriptSync.ts`)
- `BookDetailView.tsx` / `BookDetailModal.tsx` — coordination files

---

## Reader Core Agent

**Primary:**

- `apps/readest-app/src/app/reader/components/FoliateViewer.tsx` — Foliate host and lifecycle
- Reader navigation (`navigateToReader`, `showReaderWindow`, `useBooksManager`)
- EPUB location / CFI logic (`cfi.ts`, `xcfi.ts`, `liveMarker.ts`)
- Page relocation and scroll orchestration
- Iframe/render lifecycle (`useFoliateEvents.ts`, `view.ts`)
- `booksGrid.tsx` reader frame structure

**Must coordinate before touching:**

- Global visual theme files (`book-themes.ts`, `globals.css`, `ornaments.ts`)
- Audiobook transcript/matching files (`audiobookTranscript.ts`, `transcriptSync.ts`)
- Homepage/library UI (`page.tsx`, `library/page.tsx`)
- `BookDetailView.tsx` / `BookDetailModal.tsx` — coordination files

---

## Audiobook Sync Agent

**Primary:**

- `apps/readest-app/src/app/reader/hooks/useAudiobook*` — player, sync, debug, generation
- `apps/readest-app/src/utils/audiobook*` — sync map, transcript utilities
- `apps/readest-app/src/utils/transcript*` — transcript-to-text matching
- `apps/readest-app/src/utils/liveMarker.ts` — CFI-based highlight overlays
- Audiobook sync map / transcript / highlight logic
- Book Details sync UI only when needed for sync controls

**Must coordinate before touching:**

- `FoliateViewer.tsx` — reader visual layout and CSS injection
- Homepage UI (`page.tsx`, `library/page.tsx`)
- Global visual theme files
- Broad FoliateViewer visual injection (chapter ornaments, sigils, drop caps)

---

## Infra / QA Agent

**Primary:**

- Tests (`src/__tests__/**`)
- Lint/type fixes (`biome.json`, `tsconfig.json`)
- Docs (`docs/**`, `*.md`)
- Validation scripts (`scripts/validate-*.ps1`)
- Build config (`next.config.mjs`, `package.json`, CI files)

**Must coordinate before touching:**

- Active feature files owned by another agent
- Rust backend (`src-tauri/**`) unless task is Rust-specific

---

## Coordination Files

These files are touched by multiple agents. Any edit requires checking the ownership map and coordinating with affected agents:

| File                  | Touched By                             | Why                                                                          |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `FoliateViewer.tsx`   | UI Visual, Reader Core, Audiobook Sync | CSS injection, ornaments, sigils, Foliate lifecycle, sync marker integration |
| `ReaderContent.tsx`   | UI Visual, Reader Core, Audiobook Sync | Texture styles, reader layout, auto-sync trigger                             |
| `BookDetailModal.tsx` | UI Visual, Audiobook Sync              | Visual polish, sync controls                                                 |
| `BookDetailView.tsx`  | UI Visual, Audiobook Sync              | Visual polish, sync metadata display                                         |
| `FooterBar.tsx`       | UI Visual, Reader Core                 | Reader chrome, playback controls, navigation                                 |
| `BooksGrid.tsx`       | UI Visual, Reader Core                 | Frame styling, book art, reader pane layout                                  |
| `globals.css`         | UI Visual, Reader Core                 | Design tokens, reader texture, Citadel theme                                 |
| `book-themes.ts`      | UI Visual, Reader Core, Audiobook Sync | Theme config, reader book images, ornament style mapping                     |

---

## Conflict Resolution Rules

1. Check [docs/CURRENT_SPRINT.md](CURRENT_SPRINT.md) for active branches and merge order.
2. If you need to edit a coordination file, check whether another agent is actively working on it.
3. Prefer adding new code in your primary files rather than modifying shared files.
4. If a change to a shared file is unavoidable, make it minimal and backwards-compatible.
5. When uncertain, stop and report the conflict — do not guess.
