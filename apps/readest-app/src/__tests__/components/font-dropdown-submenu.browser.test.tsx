/**
 * FontDropdown's "System Fonts" sub-list is a nested daisyUI dropdown. It must
 * open only when the user activates the "System Fonts" row (daisyUI 4 showed it
 * alongside the parent list), and the parent list must keep a real width: the
 * rows are `w-full overflow-hidden`, so a shrink-to-fit menu collapses to 0px.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

const { default: FontDropdown } = await import('@/components/settings/FontDropDown');
await import('@/styles/globals.css');

afterEach(() => cleanup());

const renderDropdown = () => {
  const onSelect = vi.fn();
  render(
    <div style={{ padding: 400 }}>
      <FontDropdown
        family='sans-serif'
        selected='Roboto'
        options={[{ option: 'Roboto' }, { option: 'Noto Sans' }]}
        moreOptions={[{ option: 'Arial' }, { option: 'Avenir' }]}
        onSelect={onSelect}
        onGetFontFamily={(option) => option}
      />
    </div>,
  );
  const menus = document.querySelectorAll<HTMLElement>('.dropdown-content');
  return { onSelect, list: menus[0]!, subList: menus[1]! };
};

const visible = (el: HTMLElement) => getComputedStyle(el).visibility === 'visible';

describe('FontDropdown system fonts sub-list', () => {
  it('opens the sub-list only from the System Fonts row', async () => {
    const { onSelect, list, subList } = renderDropdown();
    expect(visible(list)).toBe(false);

    await page.elementLocator(document.querySelector('button.btn')!).click();
    expect(visible(list)).toBe(true);
    expect(list.getBoundingClientRect().width).toBeGreaterThan(100);
    expect(visible(subList)).toBe(false);

    await page.getByText('System Fonts').click();
    expect(visible(list)).toBe(true);
    expect(visible(subList)).toBe(true);
    // The sub-list sits beside the parent list with both bottom edges flush.
    expect(
      Math.abs(subList.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(1);
    expect(subList.getBoundingClientRect().right).toBeLessThan(list.getBoundingClientRect().left);

    await page.getByRole('button', { name: 'Avenir' }).click();
    expect(onSelect).toHaveBeenCalledWith('Avenir');
  });
});

describe('FontDropdown font search', () => {
  const fonts = (names: string[]) => names.map((option) => ({ option }));

  it('filters bundled and system fonts by name', async () => {
    const onSelect = vi.fn();
    render(
      <div style={{ padding: 400 }}>
        <FontDropdown
          family='serif'
          selected='Literata'
          options={fonts(['Literata', 'Lora', 'Merriweather', 'EB Garamond', 'Bitter'])}
          moreOptions={fonts(['Georgia', 'Garamond Premier', 'Palatino', 'Times', 'Baskerville'])}
          onSelect={onSelect}
          onGetFontFamily={(option) => option}
        />
      </div>,
    );
    await page.elementLocator(document.querySelector('button.btn')!).click();
    const search = page.getByRole('searchbox');
    expect(document.querySelector('input[type="search"]')).not.toBeNull();
    await search.fill('gara');

    const shown = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map(
        (el) => el.textContent,
      );
    expect(shown()).toEqual(['EB Garamond', 'Garamond Premier']);
    expect(document.body.textContent).not.toContain('System Fonts');

    await page.getByRole('button', { name: 'Garamond Premier' }).click();
    expect(onSelect).toHaveBeenCalledWith('Garamond Premier');

    await search.fill('zzz');
    expect(shown()).toEqual([]);
    expect(document.body.textContent).toContain('No search results found');
  });

  it('has no search field when every font fits', async () => {
    renderDropdown();
    await page.elementLocator(document.querySelector('button.btn')!).click();
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });
});
