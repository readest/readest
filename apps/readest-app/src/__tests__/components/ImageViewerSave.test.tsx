import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

import ImageViewer from '@/app/reader/components/ImageViewer';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ systemUIVisible: false, statusBarHeight: 0 }),
}));

const h = vi.hoisted(() => ({
  appService: null as {
    isMobileApp: boolean;
    isMacOSApp: boolean;
    isAndroidApp?: boolean;
    saveFile: ReturnType<typeof vi.fn>;
    saveImageToGallery?: ReturnType<typeof vi.fn>;
  } | null,
  dispatch: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: h.dispatch },
}));

// "AAEC" base64 decodes to bytes [0, 1, 2].
const PNG_DATA_URL = 'data:image/png;base64,AAEC';
const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

beforeEach(() => {
  h.appService = null;
  h.dispatch.mockReset();
});

afterEach(cleanup);

describe('ImageViewer save/share button', () => {
  it('exports the image and toasts when sharing is unavailable', async () => {
    const saveFile = vi.fn().mockResolvedValue(true);
    h.appService = { isMobileApp: false, isMacOSApp: false, saveFile };

    const { getByLabelText } = render(
      <ImageViewer src={PNG_DATA_URL} onClose={vi.fn()} gridInsets={gridInsets} />,
    );

    // No native/web share → the affordance is the "Save Image" (export) button.
    fireEvent.click(getByLabelText('Save Image'));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const [filename, content, options] = saveFile.mock.calls[0]!;
    expect(filename).toBe('image.png');
    expect(content).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(content as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]));
    expect(options).toMatchObject({ share: true, mimeType: 'image/png' });
    expect(options.sharePosition).toMatchObject({ preferredEdge: 'bottom' });

    // Export path confirms with a toast.
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'info' })),
    );
  });

  it('shares via saveFile without a toast on a share-capable platform', async () => {
    const saveFile = vi.fn().mockResolvedValue(true);
    h.appService = { isMobileApp: true, isMacOSApp: false, saveFile };

    const { getByLabelText } = render(
      <ImageViewer src={PNG_DATA_URL} onClose={vi.fn()} gridInsets={gridInsets} />,
    );

    // Share-capable → the affordance is the "Share Image" button.
    fireEvent.click(getByLabelText('Share Image'));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(saveFile.mock.calls[0]![2]).toMatchObject({ share: true });
    // The OS share sheet is its own feedback; no toast on the share path.
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('saves to the photo gallery on Android instead of sharing', async () => {
    const saveImageToGallery = vi.fn().mockResolvedValue(true);
    const saveFile = vi.fn().mockResolvedValue(true);
    h.appService = {
      isMobileApp: true,
      isMacOSApp: false,
      isAndroidApp: true,
      saveFile,
      saveImageToGallery,
    };

    const { getByLabelText } = render(
      <ImageViewer src={PNG_DATA_URL} onClose={vi.fn()} gridInsets={gridInsets} />,
    );

    // Android saves to the gallery, so the affordance is "Save Image", not Share.
    fireEvent.click(getByLabelText('Save Image'));

    await waitFor(() => expect(saveImageToGallery).toHaveBeenCalledTimes(1));
    const [filename, content, mime] = saveImageToGallery.mock.calls[0]!;
    expect(filename).toBe('image.png');
    expect(content).toBeInstanceOf(ArrayBuffer);
    expect(mime).toBe('image/png');
    // It must NOT fall through to the share sheet on Android.
    expect(saveFile).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'info' })),
    );
  });
});
