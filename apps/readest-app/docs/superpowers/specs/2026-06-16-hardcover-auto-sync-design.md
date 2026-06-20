# Automatic Hardcover Sync

Date: 2026-06-16
Branch: `feat/hardcover-auto-sync`

## Problem

Hardcover sync (reading progress + notes) only runs when the user opens the
reader menu and taps "Push Progress" / "Push Notes". Users expect their
Hardcover account to update on its own as they read, the way the cloud,
KOReader, and Readwise integrations already do.

## Goal

Sync Hardcover progress and notes automatically while reading, gated by a new
**Auto Sync** toggle in the Hardcover settings. The existing menu actions stay
as a manual "sync now" force.

## Decisions

- **Scope**: both reading progress and notes/highlights (mirrors the two manual
  actions).
- **Control**: a single new `autoSync` toggle, **default OFF** (explicit
  opt-in). One toggle covers both progress and notes — no per-category
  sub-toggles.
- **Write-only**: no auto-pull. Hardcover sync is push-only today (like
  Readwise); this change keeps that.

## Design

### Settings (`src/types/settings.ts`, `src/services/constants.ts`)

```ts
export interface HardcoverSettings {
  enabled: boolean;
  accessToken: string;
  lastSyncedAt: number;
  autoSync?: boolean; // NEW — default OFF (undefined ⇒ off)
}
```

- `DEFAULT_HARDCOVER_SETTINGS` gets `autoSync: false`.
- Auto-sync runs only when `enabled && hardcover.autoSync === true` (strict).
- Migration: existing connected users have `autoSync === undefined` ⇒ OFF until
  they opt in. No behavior change on upgrade.

### Hook (`src/app/reader/hooks/useHardcoverSync.ts`)

Follows the Readwise / `useProgressSync` patterns already in the codebase.

- `pushProgress` / `pushNotes` gain a `{ silent?: boolean }` option. In silent
  mode the success/info toasts are suppressed and errors go to `console.error`
  only (matches Readwise's debounced path). Manual runs stay loud.
- Two `useMemo` + `debounce` (10s) auto-pushers, each reading settings at call
  time and gated on `enabled && autoSync === true`:
  - `debouncedPushProgress` — triggered by a reactive `useBookProgress(bookKey)`
    `location` change (page turns); calls `pushProgress({ silent: true })`.
  - `debouncedPushNotes` — triggered by `config?.booknotes` change; calls
    `pushNotes({ silent: true })`.
- Flush on close: the existing `sync-book-progress` event (dispatched in
  `ReaderContent.saveBookConfig` before unmount) flushes both debouncers so a
  quick close still sends pending work. No change to ReaderContent.
- On unmount, cancel both debouncers (no stray network calls after teardown).
- Keep the existing `hardcover-push-progress` / `hardcover-push-notes` manual
  listeners (toasts retained).

### Settings UI (`src/components/settings/integrations/HardcoverForm.tsx`)

Add a second `min-h-14` toggle row "Auto Sync" inside the existing card under
"Sync Enabled":

- `checked={settings.hardcover?.autoSync === true}` (unchecked by default).
- `handleToggleAutoSync` mirrors `handleToggleEnabled`.
- `handleConnect` sets `autoSync: settings.hardcover?.autoSync ?? false`.

## Testing (TDD)

New `src/__tests__/hooks/useHardcoverSync.test.tsx` using the `renderHook` +
mocked-store + fake-timers harness from `useProgressSync.test.tsx`:

1. progress change + `autoSync: true` → after debounce, `client.pushProgress`
   called once, no success toast (silent).
2. `autoSync` off/absent → `client.pushProgress` NOT called after debounce.
3. booknotes change + `autoSync: true` → `client.syncBookNotes` called after
   debounce.
4. `sync-book-progress` event flushes a pending push immediately.

## Out of scope

- Auto-pull from Hardcover.
- Per-category (progress vs notes) sub-toggles.
- Throttling `lastSyncedAt` settings writes (kept consistent with the existing
  manual `pushProgress` / Readwise behavior).
