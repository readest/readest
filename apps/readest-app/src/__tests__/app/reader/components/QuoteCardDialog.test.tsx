import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// readest/readest#5830: share a passage as a quote card image.

const h = vi.hoisted(() => ({
  saveFile: vi.fn(async () => true),
  saveImageToGallery: vi.fn(async () => true),
  isAndroidApp: false,
  isMobileApp: false,
  isMacOSApp: true,
  truncated: false,
  renderQuoteCard: vi.fn(),
  png: new Blob(['png'], { type: 'image/png' }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      saveFile: h.saveFile,
      saveImageToGallery: h.saveImageToGallery,
      isAndroidApp: h.isAndroidApp,
      isMobileApp: h.isMobileApp,
      isMacOSApp: h.isMacOSApp,
    },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => options?.[name] ?? ''),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));
vi.mock('@/utils/quoteCardRenderer', () => ({
  renderQuoteCard: h.renderQuoteCard,
  quoteCardToPng: vi.fn(async () => h.png),
}));

import QuoteCardDialog from '@/app/reader/components/annotator/QuoteCardDialog';
import { eventDispatcher } from '@/utils/event';
import { QUOTE_CARD_COLORS } from '@/utils/quoteCard';
import type { QuoteCardContent } from '@/utils/quoteCardRenderer';

class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}
const write = vi.fn(async () => {});

const content: QuoteCardContent = {
  text: 'Understandest thou what thou readest?',
  title: 'The Holy Bible: KJV',
  author: 'King James',
};
const readerColors = { bg: '#000000', fg: '#ffffff', accent: '#ff0000' };
const fontFamilies = { serif: '"Bitter", serif', sans: '"Roboto", sans-serif' };

const open = (defaultFont: 'serif' | 'sans' = 'serif', cardContent: QuoteCardContent = content) =>
  act(async () => {
    render(
      <QuoteCardDialog
        isOpen
        content={cardContent}
        readerColors={readerColors}
        fontFamilies={fontFamilies}
        defaultFont={defaultFont}
        onClose={vi.fn()}
      />,
    );
  });

let dispatch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.isAndroidApp = false;
  h.isMobileApp = false;
  h.isMacOSApp = true;
  h.truncated = false;
  h.renderQuoteCard.mockImplementation(async () => ({ truncated: h.truncated }));
  dispatch = vi.spyOn(eventDispatcher, 'dispatch');
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lastStyle = () => h.renderQuoteCard.mock.calls.at(-1)![2];

describe('QuoteCardDialog (#5830)', () => {
  test('renders the preview with the default style and re-renders on changes', async () => {
    await open();
    expect(h.renderQuoteCard).toHaveBeenCalled();
    expect(h.renderQuoteCard.mock.calls.at(-1)![1]).toEqual({ ...content, brand: 'via Readest' });
    expect(lastStyle()).toEqual({
      layout: 'classic',
      colors: QUOTE_CARD_COLORS.paper,
      fontFamily: fontFamilies.serif,
      shape: 'fit',
      showBookInfo: true,
      showQr: true,
    });

    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Page' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reader Theme' })));
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Sans' })));
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: '16:9' })));
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Book Info' })));
    expect(lastStyle()).toEqual({
      layout: 'page',
      colors: readerColors,
      fontFamily: fontFamilies.sans,
      shape: 'wide',
      showBookInfo: false,
      showQr: true,
    });
  });

  test('offers a QR code, on by default, only when the passage has a link', async () => {
    await open();
    expect(screen.queryByRole('checkbox', { name: /QR Code/ })).toBeNull();
    cleanup();
    await open('serif', { ...content, qrUrl: 'https://web.readest.com/o/book/abc/annotation/def' });
    expect(lastStyle().showQr).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: /QR Code/ })));
    expect(lastStyle().showQr).toBe(false);
  });

  test("starts with the reader's default font", async () => {
    await open('sans');
    expect(lastStyle().fontFamily).toBe(fontFamilies.sans);
  });

  test('shares the PNG through the system share sheet', async () => {
    await open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
    expect(h.saveFile).toHaveBeenCalledWith(
      'The Holy Bible_ KJV-quote.png',
      expect.any(ArrayBuffer),
      expect.objectContaining({ mimeType: 'image/png', share: true }),
    );
  });

  test('saves to the gallery on Android and offers no Copy Image there', async () => {
    h.isAndroidApp = true;
    h.isMobileApp = true;
    h.isMacOSApp = false;
    await open();
    expect(screen.queryByRole('button', { name: 'Copy Image' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Image' })));
    expect(h.saveImageToGallery).toHaveBeenCalledWith(
      'The Holy Bible_ KJV-quote.png',
      expect.any(ArrayBuffer),
      'image/png',
    );
    expect(h.saveFile).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'info' }));
  });

  test('saves a file on desktop and copies the image to the clipboard', async () => {
    h.isMacOSApp = false;
    await open();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Image' })));
    expect(h.saveFile).toHaveBeenCalledWith(
      'The Holy Bible_ KJV-quote.png',
      expect.any(ArrayBuffer),
      { mimeType: 'image/png' },
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy Image' })));
    expect(write).toHaveBeenCalledWith([expect.any(FakeClipboardItem)]);
  });

  test('says when the quote was shortened to fit', async () => {
    h.truncated = true;
    await open();
    expect(screen.getByText('The quote was shortened to fit the card.')).toBeTruthy();
  });
});
