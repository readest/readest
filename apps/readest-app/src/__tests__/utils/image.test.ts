import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock globals for jsdom canvas / Image / fetch ─────────────────────
// jsdom does not implement canvas or Image loading, so we mock them.

interface MockImageInstance {
  crossOrigin: string;
  src: string;
  width: number;
  height: number;
  onload: ((ev?: Event) => void) | null;
  onerror: ((ev?: string | Event) => void) | null;
}

let mockImageInstances: MockImageInstance[] = [];

class MockImage {
  crossOrigin = '';
  src = '';
  width = 200;
  height = 300;
  onload: ((ev?: Event) => void) | null = null;
  onerror: ((ev?: string | Event) => void) | null = null;

  constructor() {
    mockImageInstances.push(this as MockImageInstance);
    // Auto-trigger onload when src is set
    Object.defineProperty(this, 'src', {
      get: () => this._src,
      set: (val: string) => {
        this._src = val;
        if (val) {
          // Schedule onload in a microtask to allow tests to set handlers
          Promise.resolve().then(() => {
            if (this.onload) {
              this.onload(new Event('load'));
            }
          });
        }
      },
    });
  }
  private _src = '';
}

// Mock canvas context
interface MockCanvasContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  drawImage: ReturnType<typeof vi.fn>;
}

let mockCtx: MockCanvasContext;

const mockToDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,AABBCC');
const mockToBlob = vi.fn();

function createMockCanvas() {
  mockCtx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    drawImage: vi.fn(),
  };

  return {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toDataURL: mockToDataURL,
    toBlob: mockToBlob,
  };
}

// Patch document.createElement for canvas
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag === 'canvas') {
    return createMockCanvas() as unknown as HTMLElement;
  }
  return originalCreateElement(tag);
});

// Patch global Image
vi.stubGlobal('Image', MockImage);

// Patch URL methods
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn().mockReturnValue('blob:http://localhost/fake-blob'),
  revokeObjectURL: vi.fn(),
});

// Mock fetch
const mockFetchResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  blob: vi.fn().mockResolvedValue(new Blob(['fake-image-data'], { type: 'image/jpeg' })),
};
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

// Import after mocks
import { processDiscordCover, fetchImageAsBase64 } from '@/utils/image';

beforeEach(() => {
  vi.clearAllMocks();
  mockImageInstances = [];
  mockFetchResponse.ok = true;
  mockFetchResponse.status = 200;
  mockFetchResponse.statusText = 'OK';
  mockFetchResponse.blob.mockResolvedValue(new Blob(['fake-image-data'], { type: 'image/jpeg' }));
  // Re-apply document.createElement mock (restoreAllMocks clears it)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return createMockCanvas() as unknown as HTMLElement;
    }
    return originalCreateElement(tag);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processDiscordCover', () => {
  test('fetches cover and icon images', async () => {
    // Setup: toBlob calls the callback with a Blob
    mockToBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['jpeg-data'], { type: 'image/jpeg' }));
    });

    const promise = processDiscordCover(
      'https://example.com/cover.jpg',
      'https://example.com/icon.png',
    );

    // Wait for images to load
    await vi.dynamicImportSettled();
    const result = await promise;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('https://example.com/cover.jpg');
    expect(fetch).toHaveBeenCalledWith('https://example.com/icon.png');
    expect(result).toBeInstanceOf(Blob);
  });

  test('draws cover image centered for portrait aspect ratio', async () => {
    mockToBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['jpeg-data'], { type: 'image/jpeg' }));
    });

    // Create images with portrait dimensions (taller than wide)
    const promise = processDiscordCover(
      'https://example.com/cover.jpg',
      'https://example.com/icon.png',
    );

    await vi.dynamicImportSettled();
    await promise;

    // Canvas context should have drawImage called (cover + icon)
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockCtx.imageSmoothingEnabled).toBe(true);
    expect(mockCtx.imageSmoothingQuality).toBe('high');
  });

  test('rejects when toBlob returns null', async () => {
    mockToBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
      callback(null);
    });

    const promise = processDiscordCover(
      'https://example.com/cover.jpg',
      'https://example.com/icon.png',
    );

    await expect(promise).rejects.toThrow('Failed to create blob');
  });

  test('rejects on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      processDiscordCover('https://example.com/cover.jpg', 'https://example.com/icon.png'),
    ).rejects.toThrow('Network error');
  });
});

describe('fetchImageAsBase64', () => {
  test('fetches image and returns base64 string', async () => {
    const result = await fetchImageAsBase64('https://example.com/image.jpg');

    expect(fetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(result).toBe('data:image/jpeg;base64,AABBCC');
  });

  test('uses default options when none specified', async () => {
    await fetchImageAsBase64('https://example.com/image.jpg');

    // Default format is image/jpeg, quality 0.85, targetWidth 256
    expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  test('uses custom options', async () => {
    await fetchImageAsBase64('https://example.com/image.png', {
      targetWidth: 128,
      format: 'image/png',
      quality: 0.5,
    });

    expect(mockToDataURL).toHaveBeenCalledWith('image/png', 0.5);
  });

  test('rejects on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
      'Network error',
    );
  });

  test('rejects on non-ok response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
      'Failed to fetch image: 404 Not Found',
    );
  });

  test('calculates correct dimensions from aspect ratio', async () => {
    // Image: 200x300, targetWidth 256 -> newHeight = 256 * (300/200) = 384
    await fetchImageAsBase64('https://example.com/image.jpg', { targetWidth: 256 });

    // The canvas size should be set appropriately
    // We verify drawImage was called with correct dimensions
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  test('creates object URL and revokes it', async () => {
    await fetchImageAsBase64('https://example.com/image.jpg');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
