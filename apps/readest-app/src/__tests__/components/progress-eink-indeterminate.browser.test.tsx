/**
 * An indeterminate `.progress` (no value yet, e.g. ShareLanding before the
 * first byte arrives) carries daisyUI's stripe, swept along the track by a
 * five-second animation. On e-ink the sweep only smears, and a stripe held
 * still sits at the left edge, where it reads as a fill stuck near 0%. So on
 * e-ink the bar shows its bare track until it has a value.
 *
 * Asserts the resolved style of real bars, not the rule's text.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
});

const measure = (eink: boolean) => {
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  // ShareLanding's class string.
  const { container } = render(<progress className='progress progress-primary w-full' />);
  return { indeterminate: getComputedStyle(container.querySelector('progress')!) };
};

describe('indeterminate progress bar on e-ink', () => {
  it('sweeps the stripe off e-ink', () => {
    const { indeterminate } = measure(false);
    expect(indeterminate.backgroundImage).toContain('linear-gradient');
    expect(indeterminate.animationName).toBe('progress');
  });

  it('shows the bare track on e-ink: no stripe, no sweep', () => {
    const { indeterminate } = measure(true);
    expect(indeterminate.backgroundImage).toBe('none');
    expect(indeterminate.animationName).toBe('none');
  });
});
