/**
 * WebKit before Safari 17 (iOS <= 16) kills the WebContent process when a
 * `color-mix()` that takes `currentColor` wins `box-shadow` or `color` on a
 * rendered element; Readest reloads to the library (#6355). daisyUI 5 puts one
 * in the `.toggle` and `.range` thumb shadows. The themes pin `--depth: 0`, so
 * those layers mix at 0% and never paint; globals.css drops them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Toggle } from '@/components/primitives/toggle';

await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

describe('currentColor color-mix shadows (#6355)', () => {
  it('leaves no shadow on the toggle or its knob', () => {
    document.documentElement.setAttribute('data-theme', 'default-light');
    const { container } = render(<Toggle defaultChecked />);
    const toggle = container.querySelector('input') as HTMLInputElement;
    expect(getComputedStyle(toggle).boxShadow).toBe('none');
    expect(getComputedStyle(toggle, '::before').boxShadow).toBe('none');
  });

  // Chromium can't compute styles on `::-webkit-slider-thumb`, so check that
  // globals.css overrides daisyUI's thumb shadow from the outer `utilities`
  // layer, which outranks daisyUI's nested `daisyui.*` sub-layers.
  it('overrides the range thumb shadow without currentColor', () => {
    const thumbRules: CSSStyleRule[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === '.range::-webkit-slider-thumb') {
          thumbRules.push(rule);
        } else if ('cssRules' in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);

    const override = thumbRules.find(
      (rule) =>
        rule.parentRule instanceof CSSLayerBlockRule && rule.parentRule.name === 'utilities',
    );
    expect(override?.style.boxShadow).toBeTruthy();
    expect(override?.style.boxShadow).not.toMatch(/currentcolor/i);
  });
});
