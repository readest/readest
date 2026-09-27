import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauriAppPlatform: vi.fn().mockReturnValue(false),
  getByLabel: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: mocks.isTauriAppPlatform,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: mocks.getByLabel },
}));

import {
  PDF_SOURCE_LOCATION_EVENT,
  isPdfSourceLocationMessage,
  sendPdfSourceTarget,
  showPdfSourceTarget,
  type PdfSourceTarget,
} from '@/services/pdfSourceNavigation';

const target: PdfSourceTarget = {
  bookKey: 'book-0',
  page: 2,
  x: 100,
  y: 200,
  width: 80,
  height: 12,
  depth: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauriAppPlatform.mockReturnValue(false);
});

describe('PDF source navigation', () => {
  it('sends a validated same-origin message to the web reader', async () => {
    const postMessage = vi.fn();
    const focus = vi.fn();
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { closed: false, postMessage, focus },
    });

    await sendPdfSourceTarget('reader', target);

    expect(postMessage).toHaveBeenCalledWith(
      { type: PDF_SOURCE_LOCATION_EVENT, target },
      window.location.origin,
    );
    expect(focus).toHaveBeenCalled();
    expect(isPdfSourceLocationMessage(postMessage.mock.calls[0]![0])).toBe(true);
  });

  it('targets and focuses the original Tauri reader window', async () => {
    mocks.isTauriAppPlatform.mockReturnValue(true);
    const readerWindow = {
      emit: vi.fn(),
      show: vi.fn(),
      unminimize: vi.fn(),
      setFocus: vi.fn(),
    };
    mocks.getByLabel.mockResolvedValue(readerWindow);

    await sendPdfSourceTarget('reader-2', target);

    expect(mocks.getByLabel).toHaveBeenCalledWith('reader-2');
    expect(readerWindow.emit).toHaveBeenCalledWith(PDF_SOURCE_LOCATION_EVENT, target);
    expect(readerWindow.setFocus).toHaveBeenCalled();
  });

  it('navigates to the mapped PDF page and overlays its canvas', async () => {
    document.head.innerHTML = '<meta name="viewport" content="width=600, height=800">';
    document.body.innerHTML = '<div id="canvas"><canvas></canvas></div>';
    const canvas = document.querySelector('canvas')!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 1600 },
    });
    const goTo = vi.fn().mockResolvedValue(undefined);
    const view = {
      goTo,
      renderer: { getContents: () => [{ index: 1, doc: document }] },
    } as never;

    await expect(showPdfSourceTarget(view, target)).resolves.toBe(true);

    expect(goTo).toHaveBeenCalledWith(1);
    const marker = document.querySelector<HTMLElement>('[data-testid="pdf-source-target"]')!;
    expect(marker.dataset['page']).toBe('2');
    expect(marker.style.left).toBe('200px');
    expect(marker.style.top).toBe('376px');
  });
});
