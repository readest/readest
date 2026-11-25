// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReceivedGiftList from '@/app/user/components/gift/ReceivedGiftList';
import type { ReceivedGiftCard } from '@/types/gift';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? '')) : key,
}));

const HINT = 'Turn the card over to read the message';

const received = (id: string, message: string): ReceivedGiftCard => ({
  id,
  tier: 'plus',
  recipientName: 'Sam',
  senderName: 'Alex',
  message,
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2027-11-01T00:00:00Z',
});

afterEach(cleanup);

describe('ReceivedGiftList', () => {
  it('tells the recipient to turn over a card that carries a message, and only that card', () => {
    render(
      <ReceivedGiftList
        cards={[received('with', 'Happy reading!'), received('without', '  ')]}
        now={new Date('2026-11-24T00:00:00Z')}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]!.textContent).toContain(HINT);
    expect(items[1]!.textContent).not.toContain(HINT);
  });
});
