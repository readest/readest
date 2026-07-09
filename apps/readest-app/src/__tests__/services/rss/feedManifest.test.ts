import { describe, expect, it } from 'vitest';
import { assignSlots, emptyManifest, slotForArticleId } from '@/services/rss/feedManifest';
import type { ParsedFeed } from '@/types/rss';

const parsed = (ids: string[]): ParsedFeed => ({
  title: 'Blog',
  items: ids.map((id) => ({ id, title: `T-${id}`, link: `https://x/${id}`, read: false })),
});

describe('assignSlots (content-hash slots)', () => {
  it('slot is deterministic and independent of arrival order/other items', () => {
    const m1 = assignSlots(emptyManifest('https://x/feed', 'Blog'), parsed(['a', 'b']));
    const m2 = assignSlots(emptyManifest('https://x/feed', 'Blog'), parsed(['z', 'b', 'a']));
    const slotA1 = m1.entries.find((e) => e.id === 'a')!.slot;
    const slotA2 = m2.entries.find((e) => e.id === 'a')!.slot;
    expect(slotA1).toBe(slotForArticleId('a'));
    expect(slotA1).toBe(slotA2);
  });

  it('refresh preserves existing entries and read flags; new ids get their content-hash slot', () => {
    let m = assignSlots(emptyManifest('https://x/feed', 'Blog'), parsed(['a', 'b']));
    m.entries.find((e) => e.id === 'a')!.read = true; // simulate read
    // refresh: 'z' is new and appears FIRST in feed order; 'a','b' still present
    m = assignSlots(m, parsed(['z', 'a', 'b']));
    const entryA = m.entries.find((e) => e.id === 'a')!;
    const entryZ = m.entries.find((e) => e.id === 'z')!;
    expect(entryA.slot).toBe(slotForArticleId('a')); // slot preserved
    expect(entryA.read).toBe(true); // read flag preserved
    expect(entryZ.slot).toBe(slotForArticleId('z')); // new entry gets hash slot
    // a and b are in the entries (existing); z is appended
    expect(m.entries.findIndex((e) => e.id === 'z')).toBeGreaterThan(
      m.entries.findIndex((e) => e.id === 'b'),
    );
  });

  it('is idempotent when nothing new arrives', () => {
    const m1 = assignSlots(emptyManifest('u', 'B'), parsed(['a', 'b']));
    const m2 = assignSlots(m1, parsed(['a', 'b']));
    expect(m2.entries).toEqual(m1.entries);
  });
});
