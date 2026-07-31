/**
 * Layout regression test for issue #5259 (drop-down menu not fully displayed).
 *
 * Renders the real Dropdown + Menu + MenuItem with Tailwind loaded and checks,
 * in a real Chromium layout engine, that the CSS-anchored menus stay inside
 * the viewport on a narrow phone screen:
 *
 * 1. Long translations (Russian): the menu is capped to the viewport width and
 *    labels wrap to multiple lines so the full text stays readable.
 * 2. Short labels (CJK): the menu keeps its natural content width and labels
 *    do NOT wrap — guards the shrink-to-fit collapse where removing `nowrap`
 *    let menus shrink to their longest word/character.
 * 3. Every placement (start, center, end) is shifted back into the viewport
 *    when its anchor sits near a screen edge, without portaling the menu out
 *    of its DOM position next to the toggle (screen-reader traversal order).
 * 4. Explicit consumer widths (w-44) and RTL alignment are preserved.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import { DropdownProvider } from '@/context/DropdownContext';

const PHONE_WIDTH = 360;
const VIEWPORT_PADDING = 16;
const RIGHT_ANCHOR_LEFT = 280;
const LEFT_ANCHOR_LEFT = 8;

const renderMenu = (
  labels: string[],
  {
    placement = 'dropdown-end',
    anchorLeft = RIGHT_ANCHOR_LEFT,
    menuClassName = '',
    direction = 'ltr',
  }: {
    placement?: 'dropdown-bottom' | 'dropdown-center' | 'dropdown-end';
    anchorLeft?: number;
    menuClassName?: string;
    direction?: 'ltr' | 'rtl';
  } = {},
) => {
  document.documentElement.classList.toggle('ui-rtl', direction === 'rtl');
  const utils = render(
    <DropdownProvider>
      <div data-testid='dropdown-anchor' style={{ position: 'fixed', top: 8, left: anchorLeft }}>
        <Dropdown
          label='Test Menu'
          className={`dropdown-bottom ${placement}`}
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
          toggleButton={<span>⋯</span>}
          showTooltip={false}
        >
          <Menu className={`dropdown-content no-triangle z-20 mt-2 shadow-2xl ${menuClassName}`}>
            {labels.map((label) => (
              <MenuItem key={label} label={label} buttonClass='min-h-8 !py-1' transient />
            ))}
          </Menu>
        </Dropdown>
      </div>
    </DropdownProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test Menu' }));
  return utils;
};

const openMenu = () => document.querySelector<HTMLElement>('.dropdown-content')!;

const expectMenuWithinViewport = async () => {
  await waitFor(() => {
    const rect = openMenu().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(VIEWPORT_PADDING);
    expect(rect.right).toBeLessThanOrEqual(PHONE_WIDTH - VIEWPORT_PADDING);
  });
};

beforeAll(async () => {
  await page.viewport(PHONE_WIDTH, 800);
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('ui-rtl');
});

describe('Dropdown menu viewport layout', () => {
  it('keeps the menu adjacent to its toggle in the DOM for assistive tech', () => {
    renderMenu(['Показать недавно прочитанные']);

    const toggle = screen.getByRole('button', { name: 'Test Menu' });
    const menu = openMenu();
    // The menu must live next to the toggle (same anchor subtree), not in a
    // portal at the end of <body> — TalkBack/VoiceOver traversal order and
    // keyboard Tab order both follow DOM order (regression guard for the
    // Floating UI portal approach that broke screen-reader navigation).
    expect(toggle.closest('.dropdown-container')).toBe(menu.closest('.dropdown-container'));
  });

  it('caps a long-translation menu to the viewport and wraps its labels', async () => {
    renderMenu(['Управление Пользовательскими Шрифтами', 'Сбросить Шрифт']);

    await expectMenuWithinViewport();

    const longLabel = screen.getByText('Управление Пользовательскими Шрифтами');
    expect(longLabel.offsetHeight).toBeGreaterThan(30);
    // Wrapped lines must stay start-aligned; <button> defaults to center.
    expect(getComputedStyle(longLabel).textAlign).toBe('start');
    // The row must grow with the wrapped label instead of letting it
    // overflow across separators (fixed h-8 would clip it to 32px).
    const row = longLabel.closest('button')!;
    expect(row.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(
      longLabel.getBoundingClientRect().bottom,
    );
  });

  it.each([
    ['end placement near the left edge', 'dropdown-end', LEFT_ANCHOR_LEFT],
    ['start placement near the right edge', 'dropdown-bottom', RIGHT_ANCHOR_LEFT],
    ['center placement near the left edge', 'dropdown-center', LEFT_ANCHOR_LEFT],
    ['center placement near the right edge', 'dropdown-center', RIGHT_ANCHOR_LEFT],
  ] as const)('keeps %s inside the viewport', async (_name, placement, anchorLeft) => {
    renderMenu(['Управление Пользовательскими Шрифтами', 'Сбросить Шрифт'], {
      placement,
      anchorLeft,
    });

    await expectMenuWithinViewport();
  });

  it('preserves an explicit consumer width', async () => {
    renderMenu(['Revoke share'], { menuClassName: 'w-44' });

    await waitFor(() => {
      expect(openMenu().getBoundingClientRect().width).toBe(176);
    });
  });

  it('keeps natural width for short CJK labels without wrapping', async () => {
    renderMenu(['自动主题', '设置', '下载 Readest']);

    await expectMenuWithinViewport();
    const menu = openMenu();
    // Collapsed-to-longest-character would be ~40px; natural width is wider.
    expect(menu.getBoundingClientRect().width).toBeGreaterThan(80);

    for (const text of ['自动主题', '设置', '下载 Readest']) {
      const label = screen.getByText(text);
      expect(label.offsetHeight).toBeLessThanOrEqual(30);
      expect(label.closest('button')!.offsetHeight).toBe(32);
    }
  });

  it('keeps an RTL end-aligned menu inside the viewport', async () => {
    renderMenu(['Управление Пользовательскими Шрифтами', 'Сбросить Шрифт'], {
      anchorLeft: LEFT_ANCHOR_LEFT,
      direction: 'rtl',
    });

    await expectMenuWithinViewport();
  });
});
