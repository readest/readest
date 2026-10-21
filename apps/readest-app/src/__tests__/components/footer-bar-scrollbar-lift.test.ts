import { describe, expect, it } from 'vitest';
import { HORIZONTAL_SCROLLBAR_LIFT } from '@/app/reader/components/footerbar/position';

// Tailwind's `bottom-N` is N * 4px; `bottom-[Npx]` is N px.
const liftPx = (cls: string) => {
  const arbitrary = cls.match(/bottom-\[(\d+)px\]/);
  if (arbitrary) return Number(arbitrary[1]);
  const scale = cls.match(/bottom-(\d+(?:\.\d+)?)/);
  return scale ? Number(scale[1]) * 4 : 0;
};

describe('HORIZONTAL_SCROLLBAR_LIFT', () => {
  it('clears a Windows horizontal scrollbar (17px) so the footer does not cover it (#6784)', () => {
    expect(liftPx(HORIZONTAL_SCROLLBAR_LIFT)).toBeGreaterThanOrEqual(17);
  });
});
