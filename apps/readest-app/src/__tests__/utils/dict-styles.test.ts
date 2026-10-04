import { describe, expect, it } from 'vitest';
import { darkenDictStyles, getDictStyles } from '@/utils/style';

/**
 * Dictionary content is authored against a light page, and MDict entries render in a shadow root
 * with the dictionary's own CSS — so a dark gray for examples vanished on the dark popup (#6618).
 */
describe('darkenDictStyles', () => {
  it('lifts a dark gray text color', () => {
    const out = darkenDictStyles('.ex { color: #666; }');
    const hex = out.match(/#([0-9a-f]{6})/i)?.[1];
    expect(hex).toBeDefined();
    expect(parseInt(hex!.slice(0, 2), 16)).toBeGreaterThan(0xb0);
  });

  it('lifts rgb() grays and black', () => {
    expect(darkenDictStyles('.a { color: rgb(51, 51, 51); }')).not.toContain('rgb(51, 51, 51)');
    expect(darkenDictStyles('.a { color: black; }')).not.toContain('color: black');
  });

  it('keeps a coloured accent as authored', () => {
    expect(darkenDictStyles('.pos { color: #c0392b; }')).toContain('#c0392b');
  });

  it('keeps an already-light color', () => {
    expect(darkenDictStyles('.x { color: #eeeeee; }')).toContain('#eeeeee');
  });

  it('leaves backgrounds and borders alone', () => {
    const out = darkenDictStyles('.x { background-color: #666; border-color: #666; }');
    expect(out).toContain('background-color: #666');
    expect(out).toContain('border-color: #666');
  });

  it('rewrites a value that carries !important and keeps the marker', () => {
    const out = darkenDictStyles('.x { color: #333 !important; }');
    expect(out).not.toContain('#333');
    expect(out).toContain('!important');
  });

  it('leaves values it cannot parse alone', () => {
    expect(darkenDictStyles('.x { color: var(--dict-fg); }')).toContain('var(--dict-fg)');
  });
});

describe('getDictStyles', () => {
  it('paints the shadow host with the theme foreground in dark mode', () => {
    expect(getDictStyles('#111111', '#eeeeee', true)).toContain(':host { color: #eeeeee; }');
  });

  it('leaves the light-mode baseline as it was', () => {
    expect(getDictStyles('#ffffff', '#111111', false)).not.toContain(':host');
  });
});
