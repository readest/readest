// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GiftCard from '@/app/user/components/gift/GiftCard';
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

afterEach(cleanup);

describe('GiftCard', () => {
  it('renders tier, message, To and From', () => {
    render(<GiftCard face={face()} />);

    expect(screen.getByText('Readest Pro')).toBeTruthy();
    expect(screen.getByText('1 year')).toBeTruthy();
    expect(
      screen.getByText('Happy holidays! More time for the books you keep meaning to read.'),
    ).toBeTruthy();
    expect(screen.getByText('To')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText('From')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('omits To/From when empty', () => {
    render(<GiftCard face={face({ recipientName: '', senderName: '  ' })} />);

    expect(screen.queryByText('To')).toBeNull();
    expect(screen.queryByText('From')).toBeNull();
  });

  it('the message has dir="auto"', () => {
    render(<GiftCard face={face({ message: 'عطلة سعيدة' })} />);

    expect(screen.getByText('عطلة سعيدة').getAttribute('dir')).toBe('auto');
  });

  it('data-tier matches', () => {
    const { container, rerender } = render(<GiftCard face={face({ tier: 'plus' })} />);
    expect(container.querySelector('[data-tier]')?.getAttribute('data-tier')).toBe('plus');
    expect(screen.getByText('Readest Plus')).toBeTruthy();

    rerender(<GiftCard face={face({ tier: 'pro' })} />);
    expect(container.querySelector('[data-tier]')?.getAttribute('data-tier')).toBe('pro');
  });
});
