/**
 * globals.css flattens tinted surfaces on e-ink with
 * `[data-eink='true'] [class*='bg-base-content']`, so a translucent
 * `bg-base-content/10` chip becomes a solid, full-contrast block instead of a
 * wash the panel can't render.
 *
 * `[class*=…]` matches the whole class attribute as a string, so it also fires
 * on variant-prefixed utilities: `hover:bg-base-content/10` and even
 * `not-eink:hover:bg-base-content/10` painted their element solid black at
 * rest, on every screen. That swallowed the footer bar's page indicator and the
 * progress panel's page bubble whole -- black box, black text (#5667) -- and is
 * the same trap that was papered over per-element with `eink-inverted` (#4454).
 *
 * Assert resolved colors, not the class string: the whole defect is a selector
 * matching class text it was never meant to match.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

await import('@/styles/globals.css');

beforeAll(async () => {
  await page.viewport(800, 600);
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const measure = (eink: boolean) => {
  document.documentElement.setAttribute('data-theme', 'default-light');
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  const { container } = render(
    <>
      <div data-testid='rest' className='hover:bg-base-content/10 bg-transparent' />
      <div data-testid='not-eink-rest' className='not-eink:hover:bg-base-content/10' />
      <div data-testid='flattened' className='bg-base-content/10' />
      <div data-testid='ink' className='bg-base-content' />
    </>,
  );
  const bg = (id: string) =>
    getComputedStyle(container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!)
      .backgroundColor;
  return {
    rest: bg('rest'),
    notEinkRest: bg('not-eink-rest'),
    flattened: bg('flattened'),
    ink: bg('ink'),
  };
};

describe('e-ink bg-base-content flattening', () => {
  it('leaves a hover-only tint transparent at rest', () => {
    const { rest, notEinkRest } = measure(true);

    expect(rest).toBe(TRANSPARENT);
    expect(notEinkRest).toBe(TRANSPARENT);
  });

  it('still flattens a tint that is actually applied', () => {
    const { flattened, ink } = measure(true);

    expect(flattened).toBe(ink);
  });

  it('does not touch either off e-ink', () => {
    const { rest, notEinkRest, flattened, ink } = measure(false);

    expect(rest).toBe(TRANSPARENT);
    expect(notEinkRest).toBe(TRANSPARENT);
    expect(flattened).not.toBe(ink);
  });
});
