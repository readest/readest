// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { giftTimeline, type GiftTimelineCard } from '@/libs/payment/gift/timeline';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const card = (id: string, tier: 'plus' | 'pro', at: string): GiftTimelineCard => ({
  id,
  tier,
  redeemedAt: d(at),
  days: 365,
});
const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

describe('giftTimeline', () => {
  it('is free with no cards', () => {
    const t = giftTimeline([], d('2027-01-01'));
    expect(t.plan).toBe('free');
    expect(t.activeUntil).toBeNull();
  });

  it('runs one Plus card for 365 days', () => {
    const t = giftTimeline([card('a', 'plus', '2026-12-25')], d('2027-06-01'));
    expect(t.plan).toBe('plus');
    expect(iso(t.activeUntil)).toBe('2027-12-25');
    expect(iso(t.perCard['a']!.startsAt)).toBe('2026-12-25');
    expect(iso(t.perCard['a']!.endsAt)).toBe('2027-12-25');
  });

  it('chains two Plus cards', () => {
    const cards = [card('a', 'plus', '2026-12-25'), card('b', 'plus', '2027-01-10')];
    const t = giftTimeline(cards, d('2027-06-01'));
    expect(iso(t.perCard['b']!.startsAt)).toBe('2027-12-25');
    expect(iso(t.perCard['b']!.endsAt)).toBe('2028-12-24');
    expect(iso(t.activeUntil)).toBe('2028-12-24');
  });

  describe('Pro pausing Plus', () => {
    const cards = [card('plus', 'plus', '2026-12-25'), card('pro', 'pro', '2027-03-01')];
    it('shifts the Plus end', () => {
      const t = giftTimeline(cards, d('2027-06-01'));
      expect(iso(t.perCard['pro']!.startsAt)).toBe('2027-03-01');
      expect(iso(t.perCard['pro']!.endsAt)).toBe('2028-02-29');
      expect(iso(t.perCard['plus']!.startsAt)).toBe('2026-12-25');
      expect(iso(t.perCard['plus']!.endsAt)).toBe('2028-12-24');
      expect(t.plan).toBe('pro');
      expect(iso(t.activeUntil)).toBe('2028-02-29');
    });
    it('resumes Plus after Pro, then free', () => {
      const t = giftTimeline(cards, d('2028-03-10'));
      expect(t.plan).toBe('plus');
      expect(iso(t.activeUntil)).toBe('2028-12-24');
      const f = giftTimeline(cards, d('2029-01-01'));
      expect(f.plan).toBe('free');
      expect(f.activeUntil).toBeNull();
    });
    it('lists every boundary', () => {
      const t = giftTimeline(cards, d('2027-06-01'));
      expect(t.boundaries.map(iso)).toEqual(
        expect.arrayContaining(['2026-12-25', '2028-12-24', '2027-03-01', '2028-02-29']),
      );
    });
  });

  it('orders same-instant Pro cards by id regardless of input order', () => {
    const a = card('a', 'pro', '2027-01-01');
    const b = card('b', 'pro', '2027-01-01');
    const t1 = giftTimeline([a, b], d('2027-02-01'));
    const t2 = giftTimeline([b, a], d('2027-02-01'));
    expect(t1).toEqual(t2);
    expect(iso(t1.perCard['a']!.startsAt)).toBe('2027-01-01');
    expect(iso(t1.perCard['b']!.startsAt)).toBe('2028-01-01');
  });

  it('skips back-to-back Pro cards: Plus runs only after both (A 2027-01-01..2028-01-01, B ..2028-12-31, Plus 2028-12-31..2029-12-31)', () => {
    const cards = [
      card('plus', 'plus', '2027-06-01'),
      card('a', 'pro', '2027-01-01'),
      card('b', 'pro', '2027-01-01'),
    ];
    const t = giftTimeline(cards, d('2027-06-02'));
    expect(iso(t.perCard['b']!.endsAt)).toBe('2028-12-31');
    expect(iso(t.perCard['plus']!.startsAt)).toBe('2028-12-31');
    expect(iso(t.perCard['plus']!.endsAt)).toBe('2029-12-31');
  });

  it('chains Plus from a previous Plus end into two Pro cards (Plus 2 runs 2029-12-24..2030-12-24)', () => {
    const cards = [
      card('p1', 'plus', '2026-12-25'),
      card('p2', 'plus', '2027-01-10'),
      card('a', 'pro', '2027-12-25'),
      card('b', 'pro', '2027-12-25'),
    ];
    const t = giftTimeline(cards, d('2027-06-01'));
    expect(iso(t.perCard['p1']!.endsAt)).toBe('2027-12-25');
    expect(iso(t.perCard['b']!.endsAt)).toBe('2029-12-24');
    expect(iso(t.perCard['p2']!.startsAt)).toBe('2029-12-24');
    expect(iso(t.perCard['p2']!.endsAt)).toBe('2030-12-24');
  });

  it('starts a Plus redeemed inside a Pro run when Pro ends', () => {
    const cards = [card('pro', 'pro', '2027-01-01'), card('plus', 'plus', '2027-06-01')];
    const t = giftTimeline(cards, d('2027-06-02'));
    expect(iso(t.perCard['plus']!.startsAt)).toBe('2028-01-01');
    expect(iso(t.perCard['plus']!.endsAt)).toBe('2028-12-31');
  });

  it('includes a card start instant and excludes its end instant', () => {
    const cards = [card('a', 'plus', '2026-12-25')];
    expect(giftTimeline(cards, d('2026-12-25')).plan).toBe('plus');
    expect(giftTimeline(cards, d('2026-12-24')).plan).toBe('free');
    const atEnd = giftTimeline(cards, d('2027-12-25'));
    expect(atEnd.plan).toBe('free');
    expect(atEnd.activeUntil).toBeNull();
  });
});
