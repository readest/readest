// Regression test for the swipe page-turn background flash.
//
// In paginated mode each rendered view paints a full-bleed background segment
// positioned so it tracks its content on screen. The paginator rebuilds these
// on every scroll, so while the user drags a swipe the backgrounds stay glued
// to the content. The previous implementation painted evenly-spaced screen
// columns coloured by their midpoint, so a single colour spanned the whole
// viewport — mid-swipe, when two sections with different backgrounds were both
// visible, the incoming page rendered over the outgoing page's colour until the
// swipe snapped (e.g. dragging from a black page back to a white page showed the
// white page coming in black, then snapping white on release).
//
// See readest/readest swipe background flash.
import { describe, expect, it } from 'vitest';

import { computeBackgroundSegments, textureAwareBackground } from 'foliate-js/paginator.js';

describe('computeBackgroundSegments', () => {
  it('splits the background at the content seam mid-swipe (incoming page keeps its own colour)', () => {
    // Single column, container coextensive with the full-bleed background.
    // view0 is a transparent page (white via the host), view1 is a black page.
    // Dragging from view1 back toward view0: scrolled 300 of 430 px.
    const views = [
      { size: 430, bg: '' }, // page 1 — transparent, no segment
      { size: 430, bg: 'rgb(0, 0, 0)' }, // page 2 — black
    ];
    const segments = computeBackgroundSegments(views, 300, 430, 0, 430);

    // Only the black page produces a segment, and it starts at the content
    // seam (430 - 300 = 130) — it must NOT bleed left over the incoming
    // transparent page (which would render the white page black mid-swipe).
    expect(segments).toEqual([{ start: 130, size: 300, bg: 'rgb(0, 0, 0)' }]);
    expect(segments.every((s) => s.start >= 130)).toBe(true);
  });

  it('fills the whole screen at rest for a single colored page (full-bleed)', () => {
    const views = [
      { size: 430, bg: 'rgb(0, 0, 0)' },
      { size: 430, bg: '' },
    ];
    // At rest on the black page (scrollPos === its offset 0).
    const segments = computeBackgroundSegments(views, 0, 430, 0, 430);
    expect(segments).toEqual([{ start: 0, size: 430, bg: 'rgb(0, 0, 0)' }]);
  });

  it('stretches a centered page into the full-bleed gutters (inset > 0)', () => {
    // Desktop-style: container is inset 50px inside a 430px background.
    const views = [{ size: 330, bg: 'rgb(0, 0, 0)' }];
    const segments = computeBackgroundSegments(views, 0, 430, 50, 330);
    // Extends out to both background edges so the page is full-bleed.
    expect(segments).toEqual([{ start: 0, size: 430, bg: 'rgb(0, 0, 0)' }]);
  });

  it('gives each section its own full-bleed half in a two-up spread', () => {
    const views = [
      { size: 215, bg: 'rgb(255, 0, 0)' },
      { size: 215, bg: 'rgb(0, 0, 255)' },
    ];
    // bg 500 wide, container 430 inset 35 → seam at 35 + 215 = 250.
    const segments = computeBackgroundSegments(views, 0, 500, 35, 430);
    expect(segments).toEqual([
      { start: 0, size: 250, bg: 'rgb(255, 0, 0)' }, // left page bleeds into left gutter
      { start: 250, size: 250, bg: 'rgb(0, 0, 255)' }, // right page bleeds into right gutter
    ]);
  });

  it('skips views scrolled far off screen', () => {
    const views = [
      { size: 430, bg: 'rgb(0, 0, 0)' }, // offset 0 — far left, fully gone
      { size: 430, bg: 'rgb(1, 1, 1)' }, // offset 430
      { size: 430, bg: 'rgb(2, 2, 2)' }, // offset 860 — far right, beyond headroom
    ];
    // Scrolled to the middle view.
    const segments = computeBackgroundSegments(views, 430, 430, 0, 430);
    expect(segments).toEqual([{ start: 0, size: 430, bg: 'rgb(1, 1, 1)' }]);
  });
});

// Regression test for readest/readest#4399: a background texture mounted on the
// reader container (`.foliate-viewer::before`) shows in scrolled mode but is
// absent in paginated mode. The texture is occluded when the paginator paints an
// opaque fill over a page whose own background is transparent. Both modes must
// drop the fill for transparent pages while a texture is active so the texture
// shows through; pages that force their own opaque colour keep painting.
describe('textureAwareBackground', () => {
  it('drops a transparent page background when a texture is active (texture shows through)', () => {
    expect(textureAwareBackground('rgba(0, 0, 0, 0)', true)).toBe('');
    expect(textureAwareBackground('transparent', true)).toBe('');
    expect(textureAwareBackground('', true)).toBe('');
    // The real value captured from the iframe html computed `background`.
    expect(
      textureAwareBackground(
        'rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box',
        true,
      ),
    ).toBe('');
  });

  it('keeps an opaque page background even when a texture is active', () => {
    expect(textureAwareBackground('rgb(0, 0, 0)', true)).toBe('rgb(0, 0, 0)');
    expect(textureAwareBackground('rgb(255, 255, 255)', true)).toBe('rgb(255, 255, 255)');
  });

  it('never drops a background when no texture is active (no regression)', () => {
    expect(textureAwareBackground('rgba(0, 0, 0, 0)', false)).toBe('rgba(0, 0, 0, 0)');
    expect(textureAwareBackground('rgb(0, 0, 0)', false)).toBe('rgb(0, 0, 0)');
    expect(textureAwareBackground('', false)).toBe('');
  });
});
