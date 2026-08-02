/**
 * The popup surface switches on the in-app theme, which lives in
 * `html[data-theme="${color}-${light|dark}"]` (themeStore applyDataTheme).
 * Tailwind's built-in `dark:` follows prefers-color-scheme and would silently
 * never match, so this is served by the custom `theme-dark:` variant.
 *
 * Assert the resolved background, not the class string: a mistyped variant
 * still lands in the class attribute but emits no CSS at all.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

const { default: Popup } = await import('@/components/Popup');
await import('@/styles/globals.css');

beforeAll(async () => {
  await page.viewport(800, 600);
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

// Reference swatches resolved under the same theme, so the assertion compares
// the popup against real base-100/base-300 values rather than hardcoded colors.
const measure = (theme: string) => {
  document.documentElement.setAttribute('data-theme', theme);
  const { container } = render(
    <>
      <Popup width={200} height={60} position={{ dir: 'down', point: { x: 10, y: 10 } }}>
        <div style={{ height: 60 }}>content</div>
      </Popup>
      <div data-testid='base-100' className='bg-base-100' />
      <div data-testid='base-300' className='bg-base-300' />
    </>,
  );
  const bg = (el: Element) => getComputedStyle(el as HTMLElement).backgroundColor;
  return {
    popup: bg(container.querySelector('#popup-container')!),
    base100: bg(container.querySelector('[data-testid="base-100"]')!),
    base300: bg(container.querySelector('[data-testid="base-300"]')!),
  };
};

describe('Popup themed surface', () => {
  it('uses base-300 on light themes', () => {
    const { popup, base100, base300 } = measure('default-light');
    expect(base100).not.toBe(base300);
    expect(popup).toBe(base300);
  });

  it('uses base-100 on dark themes via the theme-dark variant', () => {
    const { popup, base100, base300 } = measure('default-dark');
    expect(base100).not.toBe(base300);
    expect(popup).toBe(base100);
  });
});
