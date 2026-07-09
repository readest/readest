import { describe, expect, it } from 'vitest';
import { assignSlots, emptyManifest } from '@/services/rss/feedManifest';
import type { ParsedFeed } from '@/types/rss';

const parsed = (ids: string[]): ParsedFeed => ({
  title: 'Blog',
  items: ids.map((id) => ({ id, title: `T-${id}`, link: `https://x/${id}`, read: false })),
});

describe('assignSlots (append-only)', () => {
  it('assigns sequential slots to new articles', () => {
    const m = assignSlots(emptyManifest('https://x/feed', 'Blog'), parsed(['a', 'b', 'c']));
    expect(m.entries.map((e) => [e.id, e.slot])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('keeps existing slots stable and appends only new ids on refresh', () => {
    let m = assignSlots(emptyManifest('https://x/feed', 'Blog'), parsed(['a', 'b']));
    m.entries.find((e) => e.id === 'a')!.read = true; // simulate read
    // refresh: 'z' is new and appears FIRST in feed order; 'a','b' still present
    m = assignSlots(m, parsed(['z', 'a', 'b']));
    const bySlot = m.entries.map((e) => [e.id, e.slot]);
    expect(bySlot).toEqual([
      ['a', 0],
      ['b', 1],
      ['z', 2],
    ]); // a,b keep slots; z appended
    expect(m.entries.find((e) => e.id === 'a')!.read).toBe(true); // read flag preserved
  });

  it('is idempotent when nothing new arrives', () => {
    const m1 = assignSlots(emptyManifest('u', 'B'), parsed(['a', 'b']));
    const m2 = assignSlots(m1, parsed(['a', 'b']));
    expect(m2.entries).toEqual(m1.entries);
  });
});
