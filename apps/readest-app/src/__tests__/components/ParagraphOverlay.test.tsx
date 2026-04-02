import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasSafeAreaInset: false } }),
}));

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

describe('ParagraphOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves writing presentation metadata in the overlay', async () => {
    const doc = createDoc('<p lang="ja">縦書きの段落です。</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey='book-1'
        dimOpacity={0.3}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: 'book-1',
        range,
        presentation: {
          lang: 'ja',
          dir: 'ltr',
          writingMode: 'vertical-rl',
          textOrientation: 'upright',
          vertical: true,
          rtl: true,
        },
      });
    });

    const paragraphContent = await waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });

    expect(paragraphContent.getAttribute('lang')).toBe('ja');
    expect(paragraphContent.getAttribute('dir')).toBe('ltr');
    expect(paragraphContent.style.writingMode).toBe('vertical-rl');
  });

  it('maps click zones using rtl and vertical reading order', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const doc = createDoc('<p>مرحبا بالعالم</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey='book-1'
        dimOpacity={0.3}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: true } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: 'book-1',
        range,
        presentation: {
          dir: 'rtl',
          writingMode: 'horizontal-tb',
          vertical: false,
          rtl: true,
        },
      });
    });

    const contentArea = (await waitFor(() => {
      const node = container.querySelector('.relative.flex') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    })) as HTMLDivElement;
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: 'book-1' });
    });

    cleanup();
    dispatchSpy.mockClear();

    const verticalRender = render(
      <ParagraphOverlay
        bookKey='book-1'
        dimOpacity={0.3}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        viewSettings={{ writingMode: 'vertical-rl', vertical: true, rtl: true } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: 'book-1',
        range,
        presentation: {
          dir: 'ltr',
          writingMode: 'vertical-rl',
          vertical: true,
          rtl: true,
        },
      });
    });
    dispatchSpy.mockClear();

    const verticalContentArea = (await waitFor(() => {
      const node = verticalRender.container.querySelector(
        '.relative.flex',
      ) as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    })) as HTMLDivElement;
    vi.spyOn(verticalContentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(verticalContentArea, { clientX: 150, clientY: 20 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: 'book-1' });
    });
  });
});
