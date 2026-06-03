import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard for issue #4435 (button display under the e-ink screen).
 *
 * The Android "Choose New Folder" selector in the Change Data Location dialog is
 * a `Dropdown` whose toggle carries `dropdown-toggle ... btn btn-ghost
 * btn-outline`. Under `[data-eink='true']`, globals.css inverts `.btn-outline`
 * to a solid fill (`background: base-content`, `color: base-100`). The dedicated
 * `[data-eink='true'] .dropdown-toggle` rule then neutralizes the background
 * back to transparent — but it used to leave the inverted white (`base-100`)
 * text untouched, so the label became white-on-transparent (white-on-white):
 * an empty-looking outlined box.
 *
 * Invariant: the e-ink `.dropdown-toggle` rule must reset BOTH the background
 * (transparent) AND the text color (base-content), so a transparent-background
 * toggle keeps a legible dark label regardless of any fill class it also wears.
 */
describe('e-ink dropdown-toggle legibility', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

  const block = (() => {
    const selector = "[data-eink='true'] .dropdown-toggle";
    const start = css.indexOf(selector);
    expect(start, `expected globals.css to define ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  })();

  it('neutralizes the toggle background to transparent', () => {
    expect(block).toMatch(/background-color:\s*theme\('colors\.transparent'\)/);
  });

  it('resets the toggle text color to base-content so it stays legible', () => {
    expect(block).toMatch(/color:\s*theme\('colors\.base-content'\)/);
  });
});
