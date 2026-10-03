import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  makePDF: vi.fn(),
  workerOptions: { workerSrc: './pdf.worker.mjs' },
}));

vi.mock('@pdfjs/pdf.min.mjs', () => {
  (globalThis as typeof globalThis & { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: mocks.workerOptions,
  };
  return {};
});

vi.mock('foliate-js/pdf.js', () => ({ makePDF: mocks.makePDF }));

const originalTransferToFixedLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'transferToFixedLength',
);

describe('PDF worker compatibility (readest#6015)', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.makePDF.mockResolvedValue({});
    mocks.workerOptions.workerSrc = './pdf.worker.mjs';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalTransferToFixedLength) {
      Object.defineProperty(
        ArrayBuffer.prototype,
        'transferToFixedLength',
        originalTransferToFixedLength,
      );
    }
  });

  it('loads a compatibility worker when WebKit lacks transferToFixedLength', async () => {
    Reflect.deleteProperty(ArrayBuffer.prototype, 'transferToFixedLength');
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:pdf-worker-compat');
    const { DocumentLoader } = await import('@/libs/document');

    const result = await new DocumentLoader(new File(['%PDF-'], 'minimal.pdf')).open();

    expect(result.format).toBe('PDF');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(mocks.workerOptions.workerSrc).toBe('blob:pdf-worker-compat');

    const workerBlob = createObjectURL.mock.calls[0]![0];
    if (!(workerBlob instanceof Blob)) throw new TypeError('Expected a Blob worker source');
    const workerSource = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(workerBlob);
    });
    expect(workerSource).toContain("ArrayBuffer.prototype, 'transferToFixedLength'");
    expect(workerSource).toContain('/vendor/pdfjs/pdf.worker.min.mjs');

    await new DocumentLoader(new File(['%PDF-'], 'second.pdf')).open();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('shrinks huge images in the worker on mobile WebViews (readest#6521)', async () => {
    // iPadOS: desktop user agent, touch points.
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf-worker');
    try {
      const { DocumentLoader } = await import('@/libs/document');
      await new DocumentLoader(new File(['%PDF-'], 'scan.pdf')).open();

      expect(mocks.workerOptions.workerSrc).toBe('blob:pdf-worker');
      const workerBlob = createObjectURL.mock.calls[0]![0];
      if (!(workerBlob instanceof Blob)) throw new TypeError('Expected a Blob worker source');
      const workerSource = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(workerBlob);
      });
      expect(workerSource).toContain('createImageBitmap');
      expect(workerSource).not.toContain("ArrayBuffer.prototype, 'transferToFixedLength'");
      expect(workerSource).toContain('/vendor/pdfjs/pdf.worker.min.mjs');
    } finally {
      Reflect.deleteProperty(navigator, 'userAgent');
      Reflect.deleteProperty(navigator, 'maxTouchPoints');
    }
  });
});
