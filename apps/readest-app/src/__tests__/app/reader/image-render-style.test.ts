import { describe, expect, it } from 'vitest';
import {
  isLightColor,
  isTransparentColor,
  plateColorFromBoxShadow,
  readImageRenderStyle,
  resolveImagePlate,
} from '@/app/reader/utils/imageRenderStyle';

describe('isTransparentColor', () => {
  it('treats empty, transparent and none as nothing painted', () => {
    expect(isTransparentColor('')).toBe(true);
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('none')).toBe(true);
    expect(isTransparentColor('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparentColor('rgba(255, 255, 255, 0)')).toBe(true);
  });

  it('treats any painted color as a fill', () => {
    expect(isTransparentColor('rgb(255, 255, 255)')).toBe(false);
    expect(isTransparentColor('rgba(0, 0, 0, 0.5)')).toBe(false);
    expect(isTransparentColor('#fff')).toBe(false);
  });

  it('reads the alpha of a modern color space with a slash', () => {
    expect(isTransparentColor('oklab(0.5 0 0 / 0)')).toBe(true);
    expect(isTransparentColor('oklab(0.5 0 0 / 0.4)')).toBe(false);
    expect(isTransparentColor('color(srgb 1 1 1 / 0)')).toBe(true);
  });
});

describe('plateColorFromBoxShadow', () => {
  it('reads the plate drawn as a zero-blur inset shadow', () => {
    expect(plateColorFromBoxShadow('rgb(255, 255, 255) 0px 0px 0px 999px inset')).toBe(
      'rgb(255, 255, 255)',
    );
  });

  it('ignores a decorative inner shadow, which is not a fill', () => {
    expect(plateColorFromBoxShadow('rgb(0, 0, 0) 0px 2px 8px 0px inset')).toBeNull();
    expect(plateColorFromBoxShadow('rgba(0, 0, 0, 0.4) 0px 0px 0px 0px inset')).toBeNull();
  });

  it('ignores outer shadows and nothing at all', () => {
    expect(plateColorFromBoxShadow('none')).toBeNull();
    expect(plateColorFromBoxShadow('')).toBeNull();
    expect(plateColorFromBoxShadow('rgb(0, 0, 0) 0px 0px 0px 999px')).toBeNull();
  });

  it('picks the inset one out of a comma-separated list', () => {
    expect(
      plateColorFromBoxShadow(
        'rgb(0, 0, 0) 1px 1px 2px 0px, rgb(255, 255, 255) 0px 0px 0px 999px inset',
      ),
    ).toBe('rgb(255, 255, 255)');
  });
});

describe('readImageRenderStyle', () => {
  const makeImage = (style: string) => {
    const img = document.createElement('img');
    img.setAttribute('style', style);
    document.body.appendChild(img);
    return img;
  };

  it('reports no filter and no plate for a plain image', () => {
    const style = readImageRenderStyle(makeImage(''));
    expect(style.filter).toBe('none');
    expect(style.plate).toBeNull();
  });

  it('carries the page filter through', () => {
    const style = readImageRenderStyle(makeImage('filter: invert(100%);'));
    expect(style.filter).toBe('invert(100%)');
  });

  it('prefers the element background over a shadow', () => {
    const style = readImageRenderStyle(
      makeImage('background-color: rgb(250, 250, 250); box-shadow: inset 0 0 0 999px #fff;'),
    );
    expect(style.plate).toBe('rgb(250, 250, 250)');
  });
});

describe('resolveImagePlate', () => {
  const lineArt = { transparentRatio: 0.7, darkInkRatio: 0.95 };
  const photo = { transparentRatio: 0, darkInkRatio: 0.1 };

  it('uses the page plate whenever the page had one', () => {
    expect(resolveImagePlate({ pagePlate: 'rgb(250, 250, 250)', filter: 'none', ink: photo })).toBe(
      'rgb(250, 250, 250)',
    );
  });

  // A section is stamped with the theme it loaded under, so the book's night
  // CSS (which is what drew the plate) can vanish when the reader switches
  // theme. The pixels still say "transparent drawing", which is all the plate
  // needs to know — this is the case that regressed to a dark grey plate.
  it('pads a transparent dark-ink drawing with white when the page gave no plate', () => {
    expect(resolveImagePlate({ pagePlate: null, filter: 'none', ink: lineArt })).toBe('#ffffff');
  });

  it('leaves an opaque image alone, since it covers the plate anyway', () => {
    expect(resolveImagePlate({ pagePlate: null, filter: 'none', ink: photo })).toBeNull();
  });

  it('never white-pads an image the page inverted, which would erase it', () => {
    expect(
      resolveImagePlate({
        pagePlate: null,
        filter: 'invert(1)',
        ink: lineArt,
      }),
    ).toBeNull();
    expect(
      resolveImagePlate({
        pagePlate: null,
        filter: 'invert(100%) hue-rotate(180deg)',
        ink: lineArt,
      }),
    ).toBeNull();
  });

  it('does nothing without an ink reading', () => {
    expect(resolveImagePlate({ pagePlate: null, filter: 'none', ink: null })).toBeNull();
  });
});

describe('isLightColor', () => {
  it('reads paper from the usual notations', () => {
    expect(isLightColor('rgb(255, 255, 255)')).toBe(true);
    expect(isLightColor('#fafafa')).toBe(true);
    expect(isLightColor('#fff')).toBe(true);
    expect(isLightColor('white')).toBe(true);
  });

  it('rejects a dark fill, which is what the theme rewrite leaves behind', () => {
    expect(isLightColor('rgb(30, 30, 30)')).toBe(false);
    expect(isLightColor('rgb(34, 34, 34)')).toBe(false);
    expect(isLightColor('#1e1e1e')).toBe(false);
    expect(isLightColor('black')).toBe(false);
  });

  it('answers null when it cannot tell', () => {
    expect(isLightColor(null)).toBeNull();
    expect(isLightColor('')).toBeNull();
    expect(isLightColor('oklab(0.9 0 0)')).toBeNull();
  });
});

describe('resolveImagePlate vs a rewritten page fill', () => {
  const lineArt = { transparentRatio: 0.7, darkInkRatio: 0.95 };

  // `transformStylesheet` rewrites the book's light backgrounds to the theme
  // colour in dark mode, including the `#fff` it uses behind a transparent
  // drawing. The page still looks right (its white shadow paints over the
  // fill), but copying the fill verbatim put black ink on #1e1e1e.
  it('refuses a dark page fill under dark ink', () => {
    expect(resolveImagePlate({ pagePlate: 'rgb(30, 30, 30)', filter: 'none', ink: lineArt })).toBe(
      '#ffffff',
    );
  });

  it('keeps a page fill that really is paper', () => {
    expect(
      resolveImagePlate({ pagePlate: 'rgb(250, 250, 250)', filter: 'none', ink: lineArt }),
    ).toBe('rgb(250, 250, 250)');
  });

  it('keeps the dark fill the page chose for already-inverted art', () => {
    expect(
      resolveImagePlate({ pagePlate: 'rgb(30, 30, 30)', filter: 'invert(1)', ink: lineArt }),
    ).toBe('rgb(30, 30, 30)');
  });
});
