---
name: ink-sync-reply-drops-strokes
description: "Sync replies made useHandwriting reload and wipe undo (stamp, jsonb key order, merge note order); MERGED #7014 (c70168a15) UNRELEASED, device-verified on Leaf5C; clock-skew stamp rule split to a later PR"
metadata:
  node_type: memory
  type: project
  originSessionId: ad4bac7c-eb46-4386-b81a-88dfecab9eae
  modified: 2026-10-21T07:47:54.513Z
---

2026-10-21. `pages/api/sync.ts` stamps an INSERTED note with the server clock (updates keep the client stamp; no
book_notes trigger). So the reply to a new drawing's first push carries the pushed ink with a newer stamp:
- `useNotesSync` took it over local ink that gained strokes while the push was in flight (strokes lost).
- `useHandwriting` reloaded on any ink-note `updatedAt` change, so even a same-ink restamp rebuilt the editor:
  live stroke cleared (`setEditor` sets `live = []`) and undo history gone.
- `withInkNotes` stamped `now`, not `nextBooknoteStamp`, so with a lagging clock a later stroke or erase sorted
  before the server stamp and never pushed (the [[note-edit-clock-skew-sync-wipe-6544]] rule, missed here).

Fix: MERGED #7014 as c70168a15 on 2026-10-23 (review follow-ups: guard keyed to the oldest unanswered push, cleared once a copy merges; incoming deletions bypass it; concurrent live edits left as known limitation): pushedAt map in useNotesSync
(local changed since push => keep local, restamp after reply); `inkSignature` in persistence.ts drops stamps, sorts
drawings by id and stroke keys; `withInkNotes` compares with the key-sorted JSON. NOT in it (split out, "PR B"):
nextBooknoteStamp in withInkNotes (edit + tombstone), patch kept as scratchpad all.patch of session ad4bac7c.

2026-10-21 CONFIRMED on the Leaf5C (0.12.16): undo did nothing online and worked with Wi-Fi off (pen taps
reached the button; the screen never changed). Gotcha: `ink` is a jsonb column, so the reply's strokes come back
with keys reordered (shortest first); a plain JSON.stringify signature still reloads. Sort keys in `inkSignature`.

**Why:** the user asked to fix "dropped strokes" seen in the Leaf5C demo [[leaf5c-adb-handwriting-demo]], but
those drops happened in a session whose note was already on the server (update path), so this race likely did NOT
cause them. Their real cause (touch slop on injected input?) is unconfirmed.
**How to apply:** don't claim this fixed the demo drops; device repro still needed (Leaf5C was in use by someone).

2026-10-23 third reload cause, found by a CDP logpoint diffing the signatures on the device: the `useNotesSync`
merge (`[...old notes not in reply, ...reply notes]`) moves synced notes to the END of the list, so an order-sensitive
signature still reloads. Fixed by sorting by id; the Leaf5C then showed 9 undos stepping the stack 32->24 with pushes
returning 200 and no `setEditor`. Also seen, NOT fixed: concurrent pushes of one new note both insert and fail with
`book_notes_pkey` (check-then-insert in upsertRecords).
