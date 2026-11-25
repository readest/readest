// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GiftCard, {
  messageSize,
  romanYear,
  slantsAndSpaces,
} from '@/app/user/components/gift/GiftCard';
import type { GiftCardFace } from '@/types/gift';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? '')) : key,
}));

const face = (overrides: Partial<GiftCardFace> = {}): GiftCardFace => ({
  tier: 'pro',
  recipientName: 'Sam',
  senderName: 'Alex',
  message: 'Happy holidays! More time for the books you keep meaning to read.',
  ...overrides,
});

const card = () => document.querySelector('[data-tier]') as HTMLElement;
const sideOf = (text: string) =>
  screen.getByText(text).closest('[data-face]')?.getAttribute('data-face');
const hidden = (name: 'front' | 'back') =>
  document.querySelector(`[data-face='${name}']`)?.getAttribute('aria-hidden') === 'true';

afterEach(cleanup);

describe('GiftCard', () => {
  it('the cover carries the plan and the year; the bookplate the names and message', () => {
    render(<GiftCard face={face()} year={2026} />);

    expect(sideOf('Pro')).toBe('front');
    expect(sideOf('1 year')).toBe('front');
    expect(sideOf('Gift card')).toBe('front');
    expect(sideOf('Happy holidays! More time for the books you keep meaning to read.')).toBe(
      'back',
    );
    expect(sideOf('Sam')).toBe('back');
    expect(sideOf('Alex')).toBe('back');
    expect(sideOf('Ex dono')).toBe('back');
    expect(screen.getAllByText('MMXXVI').length).toBeGreaterThan(0);
  });

  // Owner: "Can we use the Readest icon on the card".
  it('stamps the Readest icon on the cover', () => {
    render(<GiftCard face={face()} year={2026} />);

    const icon = card().querySelector("[data-face='front'] img") as HTMLImageElement | null;
    // next/image routes it through /_next/image here; the app serves it as is.
    expect(decodeURIComponent(icon?.getAttribute('src') ?? '')).toContain('/icon.png');
    // The cover's text already names it; the picture is decoration.
    expect(icon?.getAttribute('alt')).toBe('');
  });

  it('omits To and the signature when the names are empty', () => {
    render(<GiftCard face={face({ recipientName: '', senderName: '  ' })} />);

    expect(screen.queryByText('To')).toBeNull();
    expect(screen.queryByText('—', { exact: false })).toBeNull();
  });

  it('the message has dir="auto"', () => {
    render(<GiftCard face={face({ message: 'عطلة سعيدة' })} />);

    expect(screen.getByText('عطلة سعيدة').getAttribute('dir')).toBe('auto');
  });

  it('data-tier matches', () => {
    const { rerender } = render(<GiftCard face={face({ tier: 'plus' })} />);
    expect(card().getAttribute('data-tier')).toBe('plus');
    expect(screen.getByText('Plus')).toBeTruthy();

    rerender(<GiftCard face={face({ tier: 'pro' })} />);
    expect(card().getAttribute('data-tier')).toBe('pro');
  });

  it('shows the cover first and turns over on Turn over, and back again', () => {
    render(<GiftCard face={face()} />);
    expect(card().getAttribute('data-side')).toBe('front');
    expect(hidden('back')).toBe(true);
    expect(hidden('front')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Turn over' }));
    expect(card().getAttribute('data-side')).toBe('back');
    expect(hidden('front')).toBe(true);
    expect(hidden('back')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Turn over' }));
    expect(card().getAttribute('data-side')).toBe('front');
  });

  it('follows a side it is given and reports the turn instead', () => {
    const onSideChange = vi.fn();
    const { rerender } = render(<GiftCard face={face()} side='back' onSideChange={onSideChange} />);
    expect(card().getAttribute('data-side')).toBe('back');

    fireEvent.click(screen.getByRole('button', { name: 'Turn over' }));
    expect(onSideChange).toHaveBeenCalledWith('front');
    // Still the side it was given until the parent changes it.
    expect(card().getAttribute('data-side')).toBe('back');

    rerender(<GiftCard face={face()} side='front' onSideChange={onSideChange} />);
    expect(card().getAttribute('data-side')).toBe('front');
  });

  it('slants and letter-spaces only scripts that take it', () => {
    expect(slantsAndSpaces('Ex dono')).toBe(true);
    expect(slantsAndSpaces('Karte umdrehen')).toBe(true);
    expect(slantsAndSpaces('Подарочная карта')).toBe(true);
    expect(slantsAndSpaces('Δωροκάρτα')).toBe(true);
    // Spacing breaks joined letters; a synthesized slant reads as a mistake.
    expect(slantsAndSpaces('إهداء')).toBe(false);
    expect(slantsAndSpaces('שי')).toBe(false);
    expect(slantsAndSpaces('सप्रेम भेंट')).toBe(false);
    expect(slantsAndSpaces('敬赠')).toBe(false);
    expect(slantsAndSpaces('증정')).toBe(false);
    expect(slantsAndSpaces('พลิกบัตร')).toBe(false);
  });

  it('sets an Arabic or Chinese message upright, an English one in italics', () => {
    const { rerender } = render(<GiftCard face={face({ message: 'Happy reading' })} />);
    expect(screen.getByText('Happy reading').className).toContain('italic');

    rerender(<GiftCard face={face({ message: 'عطلة سعيدة' })} />);
    expect(screen.getByText('عطلة سعيدة').className).not.toContain('italic');

    rerender(<GiftCard face={face({ message: '新年快乐，多读书' })} />);
    expect(screen.getByText('新年快乐，多读书').className).not.toContain('italic');
  });

  // Review (CodeRabbit): a narrower card can wrap the message onto one line
  // more while holding the same number of lines; the fit check reruns on any
  // resize, not only when that number changes.
  it('steps the message down when a resize makes it overflow at the same line count', () => {
    let resized = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => ({ lineHeight: '15px', getPropertyValue: () => '' }) as unknown as CSSStyleDeclaration,
    );
    const LONG = 'word '.repeat(60).trim();
    render(<GiftCard face={face({ message: LONG })} side='back' />);
    const text = screen.getByText(LONG);
    const area = text.parentElement!;
    const size = (px: number) => ({ configurable: true, get: () => px });
    Object.defineProperty(area, 'clientHeight', size(105));
    Object.defineProperty(text, 'clientHeight', size(105));
    Object.defineProperty(text, 'scrollHeight', size(105));
    act(() => resized());
    expect(area.className).toContain('text-[max(11px,3cqw)]');

    // Narrower: still 7 lines of room, but the message now needs 8.
    Object.defineProperty(text, 'scrollHeight', size(120));
    act(() => resized());

    expect(area.className).toContain('text-[max(10px,2.7cqw)]');
    vi.unstubAllGlobals();
  });

  it('writes the year in Roman numerals', () => {
    expect(romanYear(2026)).toBe('MMXXVI');
    expect(romanYear(2027)).toBe('MMXXVII');
    expect(romanYear(1999)).toBe('MCMXCIX');
    expect(romanYear(2049)).toBe('MMXLIX');
  });

  it('sizes the message by its lines as well as its length', () => {
    expect(messageSize('Happy holidays! More time for the books you keep meaning to read.')).toBe(
      'large',
    );
    // Short, but six lines: set small enough that the sign-off isn't what gets cut.
    expect(
      messageSize('Dear Sam,\n\nHappy holidays! A whole year of reading, on me.\n\nLove,\nAlex'),
    ).toBe('small');
    expect(messageSize('Happy reading, Sam!\nAlex')).toBe('large');
    expect(messageSize('word '.repeat(30))).toBe('medium');
    expect(messageSize('word '.repeat(60))).toBe('small');
  });
});
