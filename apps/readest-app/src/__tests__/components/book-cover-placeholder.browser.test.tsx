import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import BookCover from '@/components/BookCover';
import type { Book } from '@/types/book';

await import('@/styles/globals.css');

vi.mock('@/hooks/useDefaultBookshelfCovers', () => ({
  useDefaultBookshelfCovers: () => ({ hideCovers: false }),
}));

const book: Book = {
  hash: '6e16b9ea78d31201',
  title: 'A Room of One’s Own',
  author: 'Virginia Woolf',
  format: 'TXT',
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('dir');
});

describe('Classic placeholder covers', () => {
  it('keeps cover art colors across light, dark and sepia themes', () => {
    const { container } = render(<BookCover book={book} />);
    const cover = container.querySelector<HTMLElement>('.fallback-cover')!;
    for (const theme of ['default-light', 'default-dark', 'sepia-light']) {
      document.documentElement.setAttribute('data-theme', theme);
      expect(getComputedStyle(cover).backgroundColor).toBe('rgb(161, 85, 67)');
      expect(getComputedStyle(cover).color).toBe('rgb(255, 248, 231)');
    }
  });

  it.each([
    'default-light',
    'default-dark',
    'sepia-light',
  ])('switches to theme paper, ink and a crisp border on e-ink (%s)', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const { container } = render(<BookCover book={book} />);
    const cover = container.querySelector<HTMLElement>('.fallback-cover')!;
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--color-base-100)';
    probe.style.color = 'var(--color-base-content)';
    container.append(probe);
    const { backgroundColor: paper, color: ink } = getComputedStyle(probe);

    document.documentElement.setAttribute('data-eink', 'true');
    const style = getComputedStyle(cover);
    expect(style.backgroundColor).toBe(paper);
    expect(style.color).toBe(ink);
    expect(style.borderColor).toBe(ink);
    expect(style.borderTopWidth).toBe('1px');
    expect(style.boxShadow).toBe('none');
    expect(getComputedStyle(cover.querySelector('.fallback-cover-spine')!).opacity).toBe('1');
    expect(getComputedStyle(cover.querySelector('.fallback-cover-author')!).color).toBe(ink);

    document.documentElement.removeAttribute('data-eink');
    expect(getComputedStyle(cover).backgroundColor).toBe('rgb(161, 85, 67)');
  });

  for (const coverFit of ['crop', 'fit'] as const) {
    for (const mode of ['grid', 'list', 'preview'] as const) {
      it(`contains long, CJK and RTL titles in ${mode} (${coverFit})`, () => {
        const width = mode === 'grid' ? 150 : 72;
        const { container, rerender } = render(<div />);
        for (const title of [
          'Averylongfilenamethatkeepsgoingwithoutspaces.txt',
          'Field Notes on Walking and Paying Attention',
          '人间草木：那些平凡而美好的时刻',
          'رسائل إلى صديق بعيد عن المدينة',
        ]) {
          document.documentElement.dir = title.startsWith('رسائل') ? 'rtl' : 'ltr';
          rerender(
            <div style={{ width, height: (width * 41) / 28, fontSize: 20 }}>
              <BookCover
                book={{ ...book, title, updatedAt: title.length }}
                mode={mode === 'list' ? 'list' : 'grid'}
                isPreview={mode === 'preview'}
                coverFit={coverFit}
              />
            </div>,
          );
          const cover = container.querySelector<HTMLElement>('.fallback-cover')!;
          const text = cover.querySelector<HTMLElement>('.fallback-cover-title')!;
          const coverBox = cover.getBoundingClientRect();
          const textBox = text.getBoundingClientRect();
          expect(coverBox.width).toBeCloseTo(width, 0);
          expect(textBox.left).toBeGreaterThanOrEqual(coverBox.left);
          expect(textBox.right).toBeLessThanOrEqual(coverBox.right);
          expect(textBox.top).toBeGreaterThanOrEqual(coverBox.top);
          expect(textBox.bottom).toBeLessThanOrEqual(coverBox.bottom);
          expect(getComputedStyle(text).overflowX).toBe('hidden');
          expect(cover.scrollWidth, title).toBeLessThanOrEqual(cover.clientWidth + 1);
        }
        document.documentElement.removeAttribute('dir');
      });
    }
  }

  it('shows the colored placeholder after an image error', () => {
    const { container } = render(
      <BookCover book={{ ...book, coverImageUrl: '/missing-cover.png' }} />,
    );
    fireEvent.error(container.querySelector('img')!);
    const cover = container.querySelector<HTMLElement>('.fallback-cover')!;
    expect(getComputedStyle(cover).visibility).toBe('visible');
    expect(getComputedStyle(cover).backgroundColor).toBe('rgb(161, 85, 67)');
  });
});
