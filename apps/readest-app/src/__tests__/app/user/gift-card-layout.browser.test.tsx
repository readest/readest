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

// The cover's cloth is navy and the bookplate cream, so one pixel left of the
// title, below the middle, tells which side is showing.
const pixel = async (element: HTMLElement) => {
  const png = await page.screenshot({ element, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const x = Math.round(image.width * 0.16);
  const y = Math.round(image.height * 0.6);
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return [r!, g!, b!];
};
const near = (rgb: number[], target: number[]) =>
  rgb.every((value, i) => Math.abs(value - target[i]!) <= 24);
const NAVY_CLOTH = [31, 44, 76];
const CREAM_PLATE = [244, 236, 216];

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

  // The card's serifs aren't everywhere: Android sets it in its own serif,
  // measured wider than Georgia, and CI's Linux WebKit in a wider one still.
  // A 300-character message there needs a line more than the bookplate holds,
  // so the card steps down a size rather than cut the last line.
  it('a 300-character message is shown whole at 390px in a wide fallback font', async () => {
    const style = document.createElement('style');
    style.textContent =
      '[data-tier], [data-tier] * { font-family: Verdana, sans-serif !important; }';
    document.head.append(style);
    try {
      const { message, messageBox, signature } = await renderCard(390, LONG);

      expect(message.scrollHeight).toBeLessThanOrEqual(message.clientHeight + 1);
      expect(messageBox.bottom).toBeLessThanOrEqual(signature.top);
    } finally {
      style.remove();
    }
  });

  it('a six-line letter keeps its sign-off on a phone-width card', async () => {
    const { message, messageBox, signature } = await renderCard(390, LETTER);

    // Nothing clamped away, and the last line clears the signature.
    expect(message.scrollHeight).toBeLessThanOrEqual(message.clientHeight + 1);
    expect(messageBox.bottom).toBeLessThanOrEqual(signature.top);
  });

  // WebKit drew the bookplate, mirrored, over the cover: it draws a face's
  // positioned children through `backface-visibility: hidden`.
  it('shows only the cover at rest, and only the bookplate once turned', async () => {
    const style = document.createElement('style');
    style.textContent =
      '* { transition-duration: 0s !important; transition-delay: 0s !important; }';
    document.head.append(style);
    await page.viewport(390, 900);
    render(
      <div className='px-6 py-10'>
        <GiftCard
          face={{
            tier: 'plus',
            recipientName: 'Sam',
            senderName: 'Alex',
            message: 'Enjoy the year',
          }}
          className='mx-auto max-w-sm'
        />
      </div>,
    );
    const card = document.querySelector('[data-tier]') as HTMLElement;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const atRest = await pixel(card);
    expect(near(atRest, NAVY_CLOTH), `cover's navy cloth at rest, got rgb(${atRest})`).toBe(true);

    screen.getByRole('button', { name: 'Turn over' }).click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const turned = await pixel(card);
    expect(near(turned, CREAM_PLATE), `cream bookplate once turned, got rgb(${turned})`).toBe(true);
    style.remove();
  });
});

// Review (CodeRabbit): e-ink keeps text at full ink (DESIGN.md); its rules
// flatten colours, not opacity.
describe('gift card on e-ink', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-eink');
    cleanup();
  });

  it("draws the bookplate's imprint at full opacity on e-ink, softened elsewhere", async () => {
    await renderCard(390, 'Enjoy the year');
    const imprint = () =>
      screen.getByText(
        (_, el) => /^Readest · M/.test(el?.textContent ?? '') && el?.tagName === 'SPAN',
      );
    expect(Number(getComputedStyle(imprint()).opacity)).toBeLessThan(1);

    document.documentElement.setAttribute('data-eink', 'true');
    expect(getComputedStyle(imprint()).opacity).toBe('1');
  });
});
