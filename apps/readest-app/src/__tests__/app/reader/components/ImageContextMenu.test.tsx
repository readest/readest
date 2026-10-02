import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// readest/readest issues #6558, #6562, #6563: Readest's own right-click menu for
// book images, EPUB or PDF alike, offering only Copy Image and Save Image.

const h = vi.hoisted(() => ({
  saveFile: vi.fn(async () => true),
  imageToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveFile: h.saveFile } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/utils/image', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/image')>()),
  imageToPng: h.imageToPng,
}));

import ImageContextMenu from '@/app/reader/components/ImageContextMenu';
import { eventDispatcher } from '@/utils/event';

class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}
const write = vi.fn(async () => {});

const jpeg = new Blob(['jpg'], { type: 'image/jpeg' });
const getImage = vi.fn(async () => jpeg);
const openMenu = (bookKey = 'book-1') =>
  act(async () => {
    await eventDispatcher.dispatch('image-context-menu', { bookKey, getImage, x: 10, y: 20 });
  });

let dispatch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  dispatch = vi.spyOn(eventDispatcher, 'dispatch');
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ImageContextMenu (#6558)', () => {
  test('opens with Copy Image and Save Image for its own book only', async () => {
    render(<ImageContextMenu bookKey='book-1' />);
    await openMenu('book-2');
    expect(screen.queryByRole('menuitem')).toBeNull();
    await openMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy Image',
      'Save Image',
    ]);
  });

  test('copies the image to the clipboard as a PNG', async () => {
    render(<ImageContextMenu bookKey='book-1' />);
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Copy Image'));
    });
    expect(h.imageToPng).toHaveBeenCalledWith(jpeg);
    expect(write).toHaveBeenCalledTimes(1);
    const [item] = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0];
    expect(Object.keys(item!.items)).toEqual(['image/png']);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  test('saves the image in its own format', async () => {
    render(<ImageContextMenu bookKey='book-1' />);
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Save Image'));
    });
    expect(h.saveFile).toHaveBeenCalledWith('image.jpg', expect.any(ArrayBuffer), {
      mimeType: 'image/jpeg',
    });
    expect(dispatch).toHaveBeenCalledWith('toast', {
      type: 'info',
      message: 'Image saved successfully',
    });
  });

  test('saves an untyped image under the format its bytes show', async () => {
    // a comic page from a CBZ: the zip loader leaves its blob untyped
    getImage.mockResolvedValueOnce(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]));
    render(<ImageContextMenu bookKey='book-1' />);
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Save Image'));
    });
    expect(h.saveFile).toHaveBeenCalledWith('image.jpg', expect.any(ArrayBuffer), {
      mimeType: 'image/jpeg',
    });
    expect(h.imageToPng).not.toHaveBeenCalled();
  });

  test('converts an untyped image of unknown format to a real PNG', async () => {
    getImage.mockResolvedValueOnce(new Blob(['????']));
    render(<ImageContextMenu bookKey='book-1' />);
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Save Image'));
    });
    expect(h.imageToPng).toHaveBeenCalled();
    expect(h.saveFile).toHaveBeenCalledWith('image.png', expect.any(ArrayBuffer), {
      mimeType: 'image/png',
    });
  });
});
