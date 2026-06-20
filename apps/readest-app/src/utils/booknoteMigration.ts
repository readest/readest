import { BookNote } from '@/types/book';

/**
 * Schema v1 → v2 migration: collapse a highlight and its note that were stored
 * as two separate `type:'annotation'` records at the same CFI into one unified
 * record, tombstoning the redundant record(s) so the deletion propagates to the
 * cloud and KOReader.
 *
 * The survivor is chosen deterministically (prefer a record with a `style`, then
 * earliest `createdAt`, then smallest `id`) so independent devices converge under
 * the server's last-writer-wins merge. The latest-updated non-empty note wins.
 *
 * Idempotent: a CFI that already has a single live record is left untouched, and
 * a re-run after migration finds nothing to merge. Bookmarks, excerpts, and
 * `global` highlights are never touched. Returns the same array reference when
 * nothing changed.
 */
export function unifyAnnotations(booknotes: BookNote[]): BookNote[] {
  const groups = new Map<string, BookNote[]>();
  for (const note of booknotes) {
    if (note.type !== 'annotation') continue;
    if (note.deletedAt) continue;
    if (note.global) continue;
    if (!note.cfi) continue;
    const bucket = groups.get(note.cfi);
    if (bucket) bucket.push(note);
    else groups.set(note.cfi, [note]);
  }

  const survivorById = new Map<string, BookNote>();
  const tombstonedIds = new Set<string>();
  let changed = false;
  const now = Date.now();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    changed = true;

    const sorted = [...group].sort((a, b) => {
      const aStyled = a.style ? 0 : 1;
      const bStyled = b.style ? 0 : 1;
      if (aStyled !== bStyled) return aStyled - bStyled;
      const aCreated = a.createdAt ?? 0;
      const bCreated = b.createdAt ?? 0;
      if (aCreated !== bCreated) return aCreated - bCreated;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const survivor = sorted[0]!;

    let note = survivor.note ?? '';
    let noteUpdatedAt = note.trim().length > 0 ? (survivor.updatedAt ?? 0) : -1;
    for (const member of group) {
      const memberNote = member.note ?? '';
      if (memberNote.trim().length === 0) continue;
      const memberUpdatedAt = member.updatedAt ?? 0;
      if (memberUpdatedAt > noteUpdatedAt) {
        note = memberNote;
        noteUpdatedAt = memberUpdatedAt;
      }
    }

    survivorById.set(survivor.id, { ...survivor, note, updatedAt: now });
    for (const member of group) {
      if (member.id !== survivor.id) tombstonedIds.add(member.id);
    }
  }

  if (!changed) return booknotes;

  return booknotes.map((note) => {
    if (survivorById.has(note.id)) return survivorById.get(note.id)!;
    if (tombstonedIds.has(note.id)) return { ...note, deletedAt: now, updatedAt: now };
    return note;
  });
}
