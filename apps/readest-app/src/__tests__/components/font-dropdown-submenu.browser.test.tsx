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
