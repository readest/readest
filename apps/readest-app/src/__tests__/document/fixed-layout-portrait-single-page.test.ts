// Regression test for readest/readest issue #4984.
//
// In auto-spread mode a portrait viewport shows only one page of the two-page
// spread. The renderer already hides the other page and scales the shown page
// as a single page, but it kept the spread-centering inline margin: a left page
// gets `margin-inline-start: auto` (which pushes it toward the spine on the
// right) and a right page gets `margin-inline-end: auto` (pushing it left). With
// only one page visible and no partner to meet, that one-sided auto margin
// strands the page in one half of the viewport whenever it is narrower than the
// viewport (any zoom below 100%, or a page whose fit-scaled width is less than
// the viewport width). It also breaks tapping: the off-center page sits over a
// page-turn tap zone instead of the center menu zone, so every tap turns the
// page.
//
// The fix: in portrait, center the lone visible page (both inline margins auto)
// instead of the one-sided margin. In landscape the two pages keep their
// one-sided margins so they meet at the spine and the pair stays centered.
// `computeSpreadInlineMargins(portrait)` returns the inline-margin style for the
// left and right pages. It sets both inline margins explicitly so a re-render
// after an orientation change fully overwrites the previous layout's margins
// (frames are re-styled in place, not recreated, on rotation).

import { describe, expect, it } from 'vitest';

import { computeSpreadInlineMargins } from 'foliate-js/fixed-layout.js';

describe('computeSpreadInlineMargins (#4984)', () => {
  it('pushes each page toward the spine in landscape so the pair stays centered', () => {
    const { left, right } = computeSpreadInlineMargins(false);
    // Left page hugs the right (spine) edge; right page hugs the left edge.
    expect(left.marginInlineStart).toBe('auto');
    expect(left.marginInlineEnd).not.toBe('auto');
    expect(right.marginInlineEnd).toBe('auto');
    expect(right.marginInlineStart).not.toBe('auto');
  });

  it('centers the lone visible page in portrait instead of stranding it to a side', () => {
    const { left, right } = computeSpreadInlineMargins(true);
    // Whichever page of the spread is shown, its margins are symmetric so it is
    // centered rather than shoved into one half of the viewport.
    for (const style of [left, right]) {
      expect(style.marginInlineStart).toBe('auto');
      expect(style.marginInlineEnd).toBe('auto');
    }
  });

  it('always sets both inline margins so an orientation change fully re-lays-out', () => {
    // Both modes must define both sides; otherwise a stale `auto` left over from
    // the previous orientation lingers and mis-centers the page.
    for (const portrait of [false, true]) {
      const { left, right } = computeSpreadInlineMargins(portrait);
      for (const style of [left, right]) {
        expect(style).toHaveProperty('marginInlineStart');
        expect(style).toHaveProperty('marginInlineEnd');
      }
    }
  });
});
