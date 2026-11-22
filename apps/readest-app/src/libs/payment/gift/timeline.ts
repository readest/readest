import { GiftTier } from '@/types/gift';

const DAY_MS = 86_400_000;

export interface GiftTimelineCard {
  id: string;
  tier: GiftTier;
  redeemedAt: Date;
  days: number;
}

export interface GiftTimeline {
  plan: 'free' | GiftTier;
  activeUntil: Date | null;
  perCard: Record<string, { startsAt: Date; endsAt: Date }>;
  boundaries: Date[];
}

type Interval = { start: number; end: number };

const byRedeemed = (a: GiftTimelineCard, b: GiftTimelineCard) =>
  a.redeemedAt.getTime() - b.redeemedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const within = (t: number, { start, end }: Interval) => t >= start && t < end;

/**
 * Pro cards chain back to back. Plus cards chain too, but Pro pauses them:
 * a Plus card only spends its days outside Pro intervals.
 */
export const giftTimeline = (cards: GiftTimelineCard[], now: Date): GiftTimeline => {
  const perId: Record<string, Interval> = {};

  const proIntervals: Interval[] = [];
  let proEnd = -Infinity;
  for (const c of cards.filter((c) => c.tier === 'pro').sort(byRedeemed)) {
    const start = Math.max(c.redeemedAt.getTime(), proEnd);
    proEnd = start + c.days * DAY_MS;
    proIntervals.push({ start, end: proEnd });
    perId[c.id] = { start, end: proEnd };
  }

  const plusIntervals: Interval[] = [];
  let plusEnd = -Infinity;
  for (const c of cards.filter((c) => c.tier === 'plus').sort(byRedeemed)) {
    const start = Math.max(c.redeemedAt.getTime(), plusEnd);
    let cursor = start;
    let remaining = c.days * DAY_MS;
    for (;;) {
      const inPro = proIntervals.find((p) => within(cursor, p));
      if (inPro) cursor = inPro.end;
      const nextPro = proIntervals.find((p) => p.start > cursor);
      if (!nextPro || cursor + remaining <= nextPro.start) {
        cursor += remaining;
        break;
      }
      remaining -= nextPro.start - cursor;
      cursor = nextPro.end;
    }
    plusEnd = cursor;
    plusIntervals.push({ start, end: plusEnd });
    perId[c.id] = { start, end: plusEnd };
  }

  const planAt = (t: number): 'free' | GiftTier =>
    proIntervals.some((p) => within(t, p))
      ? 'pro'
      : plusIntervals.some((p) => within(t, p))
        ? 'plus'
        : 'free';

  const perCard: GiftTimeline['perCard'] = {};
  const boundaryTimes = new Set<number>();
  for (const [id, { start, end }] of Object.entries(perId)) {
    perCard[id] = { startsAt: new Date(start), endsAt: new Date(end) };
    boundaryTimes.add(start);
    boundaryTimes.add(end);
  }
  const sorted = [...boundaryTimes].sort((a, b) => a - b);

  const plan = planAt(now.getTime());
  const next = sorted.find((t) => t > now.getTime() && planAt(t) !== plan);
  return {
    plan,
    activeUntil: plan === 'free' || next === undefined ? null : new Date(next),
    perCard,
    boundaries: sorted.map((t) => new Date(t)),
  };
};
