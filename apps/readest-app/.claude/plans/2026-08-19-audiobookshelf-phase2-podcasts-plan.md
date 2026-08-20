# Audiobookshelf Phase 2: Podcasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Podcast shows from ABS podcast libraries appear in the Readest library; opening one lists its episodes; episodes stream with per-episode progress sync.

**Architecture:** Podcast shows are `format: 'ABS'` Books under the same `abs://<serverId>/<itemId>` scheme, marked by a new `Book.absMediaType?: 'podcast'`. An episode plays through the existing `AudiobookController` as a single-track source (episode `audioTrack` + episode `chapters`), with the ABS session opened via `POST /api/items/:id/play/:episodeId` and progress keyed by `(libraryItemId, episodeId)`.

**Verified API facts (dev instance, ABS 2.36.0):** podcast library items have `mediaType: 'podcast'`; expanded items carry `media.episodes[]`; each episode: `id`, `title`, `subtitle?`, `description?`, `season?`, `episode?`, `publishedAt` (ms), `duration` (sec), `size`, `chapters[]` (same shape as book chapters), `audioTrack` `{ index, startOffset: 0, duration, contentUrl, mimeType }`. `mediaProgress` entries carry `episodeId` for podcast progress. Playback session: `POST /api/items/:itemId/play/:episodeId`.

## Global Constraints

Same as Phase 1 (see 2026-08-18-audiobookshelf-phase1-plan.md): worktree /Users/chrox/dev/readest-feat-audiobookshelf-phase1, TypeScript strict no `any`, test-first, `pnpm test <path>` no `--`, full `pnpm test` + `pnpm lint` green per task, commit style (English, no em/en dashes, Co-Authored-By Claude Fable 5), i18n `_()`, RTL logical classes, e-ink rules, minimum scope. Phase 1 interfaces are merged and MUST NOT be broken: `AudiobookController(source, clock, hooks)`, `AudiobookSource { itemId, title, author, tracks, chapters, resolveUrl, startAt }`, `AbsProgressSyncer`, `openAudiobookSession`, `reconcileAbsBooks`, `findABSServerById`.

---

### Task P1: Episode types, client episode session, per-episode progress

**Files:**
- Modify: `src/types/audiobookshelf.ts` (add `ABSEpisode`; extend `ABSLibraryItem['media']` with `episodes?: ABSEpisode[]`; add `episodeId?: string | null` to `ABSMediaProgress`)
- Modify: `src/services/audiobookshelf/client.ts` (`openPlaybackSession(itemId, episodeId?)` appends `/${episodeId}` when given)
- Modify: `src/services/audiobookshelf/progressSync.ts` (`AbsProgressSyncer` ctor gains optional `episodeId`; `begin` matches `mediaProgress` by `(libraryItemId, episodeId)`; session open passes episodeId; localStorage key becomes `abs-last-played-<bookHash>:<episodeId>` for episodes, unchanged for books)
- Tests: extend `abs-client.test.ts` + `abs-progress-sync.test.ts`

**Interfaces produced:**
```ts
export interface ABSEpisode {
  id: string;
  title: string;
  subtitle?: string | null;
  season?: string | null;
  episode?: string | null;
  publishedAt?: number | null; // ms
  duration?: number; // sec
  chapters?: ABSChapter[];
  audioTrack?: ABSTrack;
}
```
Behavioral contract (tests): session URL with/without episodeId; `begin` resolves resume from the matching `(itemId, episodeId)` progress entry, ignoring the show-level or other-episode entries; episode localStorage key isolation.

### Task P2: Library sync includes podcast shows

**Files:**
- Modify: `src/types/book.ts` (`Book.absMediaType?: 'podcast'` with comment; audiobook shows remain unmarked)
- Modify: `src/services/audiobookshelf/librarySync.ts` (`reconcileAbsBooks` accepts podcast items: `mediaType === 'podcast'` becomes a Book stub with `absMediaType: 'podcast'`, `duration` undefined, title/author from metadata, change detection includes episode count via `media.numEpisodes ?? media.episodes?.length`; progress mapping for shows skipped — per-episode progress is Task P4's concern)
- Modify: `src/components/settings/integrations/ABSForm.tsx` (library picker lists podcast libraries too, still default-selected; label unchanged)
- Modify: `src/app/library/components/BookItem.tsx` (podcast badge: `_('{{count}} episodes')` style count instead of duration; keep headphone glyph)
- Tests: extend `abs-library-sync.test.ts` (podcast included with absMediaType, ebook-only still skipped, episode-count change triggers upsert) + abs-form test (podcast library appears in picker)

### Task P3: Episode session in the factory and controller source

**Files:**
- Modify: `src/services/audiobook/openAudiobook.ts` (`openAudiobookSession` gains optional `episodeId`; for podcast books it is REQUIRED — without it return the expanded item's episodes instead of claiming: new exported `loadAbsEpisodes(appService, book): Promise<{ episodes: ABSEpisode[]; progressByEpisodeId: Map<string, ABSMediaProgress> } | null>`; with it, build `AudiobookSource` from the episode: `tracks: [episode.audioTrack]`, `chapters: episode.chapters ?? []`, `title: episode.title`, `author: show title`, syncer with episodeId; session reuse key stays the book hash but a DIFFERENT episodeId replaces the session)
- Tests: extend `open-audiobook.test.ts` (podcast without episodeId loads episodes and does not claim; with episodeId claims a single-track source; switching episodes replaces the session cleanly through `ttsSessionManager.claim`)

### Task P4: Episodes view in the player

**Files:**
- Modify: `src/app/player/page.tsx` + `src/app/player/components/PlayerView.tsx`; Create: `src/app/player/components/EpisodesView.tsx`
- Behavior: for a podcast book, the route loads episodes (Task P3 helper) and shows the Episodes view first (no auto-claim): rows newest-first by `publishedAt` — title, date (`toLocaleDateString`), duration, played/progress indicator from `progressByEpisodeId`; tapping an episode calls `openAudiobookSession` with that episodeId, auto-starts, and switches to the transport view with an "Episodes" button (replacing the audiobook-only Chapters button when the episode has no chapters; keep Chapters when it does).
- Session-ended for an episode returns to the Episodes view (refreshing progress), not the library.
- E-ink: active-row `eink-bordered`; RTL logical classes; strings via `_()`.
- Tests: extend the player page test (podcast book renders episodes list without claiming; tapping an episode claims), mirror the existing StrictMode/store-churn test setup.

### Task P5: Device verification + ledger

- Full `pnpm test` + `pnpm lint`; rebuild `pnpm dev-android`; on the Xiaomi with the dev instance: Podcasts library appears in the picker after Sync Now; The Changelog/Syntax/99% Invisible in the grid with episode-count badges; open The Changelog -> 3 episodes newest-first; play one -> audio + position + server `mediaProgress` with the episodeId; switch episodes; background survival. Record results; update the phase-1 memory file with a Phase 2 section; ledger entries in the SAME SDD workspace (new ledger file progress-phase2.md).
