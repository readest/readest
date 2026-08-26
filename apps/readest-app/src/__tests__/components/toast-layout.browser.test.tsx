/**
 * A toast must size itself to its message and keep its distance from the top
 * bar.
 *
 * daisyUI 4 gave `.toast` `min-width: fit-content` and `padding: 1rem`, so the
 * component's own `w-auto` was a no-op and the alert sat 1rem below the `top`
 * the component computes for the header. daisyUI 5 swapped the min-width for
 * `width: max-content` and moved the padding into the insets: `w-auto` now
 * wins over the width, and a fixed box with `inset-inline: 50%` (toast-center)
 * and `width: auto` resolves to zero, collapsing every toast onto its icon.
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, act, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));

const { Toast } = await import('@/components/Toast');
const { eventDispatcher } = await import('@/utils/event');
await import('@/styles/globals.css');

// The offset the component computes for the reader/library top bar, plus the
// 1rem `.toast` padding daisyUI 4 drew between that offset and the alert.
const TOP_BAR = 44;
const TOAST_GAP = 16;

beforeAll(async () => {
  await page.viewport(1024, 768);
});

afterEach(() => cleanup());

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// The toast fades and scales in, and daisyUI 5 gives the alert an entrance
// animation of its own. Both move the box while they run and
// `getBoundingClientRect` sees them, so run every animation under the toast to
// its end state instead of waiting on the clock.
const showToast = async (detail: Record<string, unknown>) => {
  render(<Toast />);
  await act(async () => {
    await eventDispatcher.dispatch('toast', detail);
  });
  const toast = document.querySelector('.toast') as HTMLElement;
  await waitFor(() => expect(toast.className).toContain('opacity-100'));
  await nextFrame();
  for (const animation of toast.getAnimations({ subtree: true })) animation.finish();
  await nextFrame();
  return toast;
};

describe('Toast layout', () => {
  it('sizes an info toast to its message', async () => {
    const toast = await showToast({ type: 'info', message: 'Copied to clipboard' });
    const message = screen.getByText('Copied to clipboard');

    expect(message.getBoundingClientRect().width).toBeGreaterThan(0);
    // The whole message fits: `truncate` hides any overflow, so a collapsed
    // box shows an ellipsis at best and nothing at worst.
    expect(message.scrollWidth).toBeLessThanOrEqual(message.clientWidth);
    expect(toast.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      message.getBoundingClientRect().width,
    );
  });

  it('centers the info toast on the viewport', async () => {
    const toast = await showToast({ type: 'info', message: 'Copied to clipboard' });
    const box = toast.getBoundingClientRect();

    expect(box.left + box.width / 2).toBeCloseTo(window.innerWidth / 2, 0);
    expect(box.top + box.height / 2).toBeCloseTo(window.innerHeight / 2, 0);
  });

  it('keeps a top toast below the top bar', async () => {
    const toast = await showToast({ type: 'error', message: 'Something went wrong' });
    const alert = toast.querySelector('.alert') as HTMLElement;

    expect(alert.getBoundingClientRect().top).toBe(TOP_BAR + TOAST_GAP);
    expect(screen.getByText('Something went wrong').getBoundingClientRect().width).toBeGreaterThan(
      0,
    );
  });
});
