// `-webkit-overflow-scrolling` has no CSSOM representation in Chromium/Firefox,
// so it can't be asserted via getComputedStyle/CSSStyleRule here -- read the
// authored source instead, which is what actually ships to iOS WKWebView.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const globalsCssPath = path.resolve(process.cwd(), 'src/styles/globals.css');
const globalsCss = readFileSync(globalsCssPath, 'utf-8');

describe('foliate-view::part(container) overscroll', () => {
  it('enables native momentum scrolling so mobile WebKit renders elastic overscroll', () => {
    const match = globalsCss.match(/foliate-view::part\(container\)\s*\{([^}]*)\}/);

    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/-webkit-overflow-scrolling\s*:\s*touch\s*;/);
  });

  it('does not disable overscroll-behavior on the container itself', () => {
    const match = globalsCss.match(/foliate-view::part\(container\)\s*\{([^}]*)\}/);

    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/overscroll-behavior\s*:\s*none/);
  });
});
