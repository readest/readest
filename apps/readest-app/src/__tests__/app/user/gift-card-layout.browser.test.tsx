/**
 * The gift card keeps ID-1 proportions and the message sits on a bookplate
 * inside its back cover, so a narrow card leaves little room for it. Whatever
 * its length, the message must stay between the To line and the signature,
 * with its last line (and the ellipsis on it) inside the bookplate.
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? '')) : key,
}));

const { default: GiftCard } = await import('@/app/user/components/gift/GiftCard');
await import('@/styles/globals.css');

const LONG =
  'Happy holidays, Sam! I know how much you love getting lost in a good story, so here is a whole year of reading for every book on your list. Read on the train, before bed, on lazy Sunday mornings. Highlight the best lines and send me your favourites. Thank you for always lending me your books. Love, Alex. xoxo!!';
const LETTER = 'Dear Sam,\n\nHappy holidays! A whole year of reading, on me.\n\nLove,\nAlex';

// The account page's padding around the card.
const renderCard = async (width: number, message: string) => {
  await page.viewport(width, 900);
  render(
    <div className='px-6 py-10'>
      <GiftCard
        face={{ tier: 'plus', recipientName: 'Sam', senderName: 'Alex', message }}
        side='back'
        className='mx-auto max-w-sm'
      />
    </div>,
  );
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const messageEl = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === message);
  return {
    message: messageEl,
    messageBox: messageEl.getBoundingClientRect(),
    to: screen.getByText('Sam').getBoundingClientRect(),
    signature: screen.getByText('Alex').getBoundingClientRect(),
    plate: screen.getByText('Ex dono').closest('[data-plate]')!.getBoundingClientRect(),
  };
};

afterEach(() => cleanup());

describe('gift card layout', () => {
  it.each([
    320, 360, 375, 390, 414, 1280,
  ])('a 300-character message stays between To and the signature at %ipx', async (width) => {
    const { messageBox, to, signature, plate } = await renderCard(width, LONG);

    expect(messageBox.top).toBeGreaterThanOrEqual(to.bottom);
    expect(messageBox.bottom).toBeLessThanOrEqual(signature.top);
    expect(messageBox.left).toBeGreaterThanOrEqual(plate.left);
    expect(messageBox.right).toBeLessThanOrEqual(plate.right);
  });

  it.each([390, 1280])('a 300-character message is shown whole at %ipx', async (width) => {
    const { message } = await renderCard(width, LONG);

    expect(message.scrollHeight).toBeLessThanOrEqual(message.clientHeight + 1);
  });

  it('a six-line letter keeps its sign-off on a phone-width card', async () => {
    const { message, messageBox, signature } = await renderCard(390, LETTER);

    // Nothing clamped away, and the last line clears the signature.
    expect(message.scrollHeight).toBeLessThanOrEqual(message.clientHeight + 1);
    expect(messageBox.bottom).toBeLessThanOrEqual(signature.top);
  });
});
