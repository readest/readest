/**
 * The desktop footer's button row is a fixed toolbar: the mouse wheel over it
 * must not move the buttons (#7985).
 *
 * The row is 32px tall and `overflow-x-auto`, which makes the other axis
 * `auto` too. Each button's `.touch-target` halo is 44px tall, 6px past the
 * row's bottom edge, so the row had 6px of vertical scroll range: one wheel
 * notch over the bar lifted every button 6px, clipped at the top, until the
 * book was reopened. Scroll ranges need real layout and a real wheel, which
 * jsdom has neither of.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '@/styles/globals.css';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import type { FooterBarChildProps } from '@/app/reader/components/footerbar/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book1',
    getView: () => null,
    getViewState: () => null,
    getProgress: () => null,
    getViewSettings: () => null,
  }),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: () => <span className='mx-2 text-sm'>12 / 345</span>,
}));

const props: FooterBarChildProps = {
  bookKey: 'book1',
  progressValid: true,
  progressFraction: 0.5,
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  actionTab: '',
  forceMobileLayout: false,
  onSetActionTab: () => {},
  onSpeakText: () => {},
  navigationHandlers: {
    onPrevPage: () => {},
    onNextPage: () => {},
    onPrevSection: () => {},
    onNextSection: () => {},
    onGoBack: () => {},
    onGoForward: () => {},
    onProgressChange: () => {},
  },
};

afterEach(() => cleanup());

describe('DesktopFooterBar wheel (#7985)', () => {
  test('the wheel over the button row does not scroll it', async () => {
    // At least 640px wide, or `sm:flex` keeps the desktop row hidden.
    await page.viewport(1280, 800);
    const { container } = render(
      // The footer bar's own box on desktop: 52px, buttons centred.
      <div className='bg-base-100 flex h-[52px] w-[1024px] flex-col justify-center'>
        <DesktopFooterBar {...props} />
      </div>,
    );
    const row = container.firstElementChild!.firstElementChild as HTMLElement;
    const button = page.getByRole('button', { name: 'Previous Page' });
    await expect.element(button).toBeVisible();
    expect(row.clientHeight).toBe(32);

    await userEvent.wheel(button, { delta: { y: 100 } });
    await userEvent.wheel(button, { delta: { y: -100 } });
    await userEvent.wheel(button, { delta: { y: 100 } });
    await new Promise((r) => setTimeout(r, 300));

    expect(row.scrollTop).toBe(0);
  });
});
