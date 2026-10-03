import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const bytes = (value: string): number[] => Array.from(new TextEncoder().encode(value));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));

import { tryNativeParsePdf } from '@/utils/tauriPdfBridge';

const XMP = `<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP Title</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Alice</rdf:li><rdf:li>Bob</rdf:li></rdf:Seq></dc:creator>
      <dc:language><rdf:Bag><rdf:li>en</rdf:li><rdf:li>fr</rdf:li></rdf:Bag></dc:language>
      <dc:publisher><rdf:Bag><rdf:li>Readest</rdf:li></rdf:Bag></dc:publisher>
    </rdf:Description>
    <rdf:Description
      xmlns:calibre="http://calibre-ebook.com/xmp-namespace"
      xmlns:calibreSI="http://calibre-ebook.com/xmp-namespace-series-index">
      <calibre:series rdf:parseType="Resource">
        <rdf:value>Native Series</rdf:value>
        <calibreSI:series_index>2.00</calibreSI:series_index>
      </calibre:series>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

describe('tryNativeParsePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'parse_pdf_metadata') {
        return {
          partialMd5: 'native-hash',
          info: {
            title: bytes('Info Title'),
            author: bytes('Info Author'),
            subject: bytes('Info Subject'),
          },
          xmp: bytes(XMP),
        };
      }
      if (command === 'render_pdf_cover') {
        return {
          coverBase64: btoa('jpeg-cover'),
          coverMime: 'image/jpeg',
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it('gets metadata from Rust and the first-page cover from Android without a JS File read', async () => {
    const openedFile = {
      name: 'example.pdf',
      getNativeLocation: () => ({ path: '/data/user/0/com.bilingify.readest/cache/example.pdf' }),
    } as unknown as File;
    const parsed = await tryNativeParsePdf(
      'content://com.android.fileexplorer.documents/document/42',
      openedFile,
      'android',
    );

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'parse_pdf_metadata', {
      filePath: '/data/user/0/com.bilingify.readest/cache/example.pdf',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'render_pdf_cover', {
      payload: {
        filePath: '/data/user/0/com.bilingify.readest/cache/example.pdf',
        maxLongEdge: 512,
      },
    });
    expect(parsed?.partialMd5).toBe('native-hash');
    expect(parsed?.bookDoc.metadata).toMatchObject({
      title: 'XMP Title',
      author: ['Alice', 'Bob'],
      language: 'enfr',
      publisher: 'Readest',
      description: 'Info Subject',
      belongsTo: { series: { name: 'Native Series', position: '2.00' } },
    });
    const cover = await parsed?.bookDoc.getCover();
    expect(cover?.type).toBe('image/jpeg');
    expect(await cover?.text()).toBe('jpeg-cover');
  });

  it('does not enable the native PDF path outside Android', async () => {
    expect(await tryNativeParsePdf('/Users/me/example.pdf', undefined, 'macos')).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not send remote URLs to native filesystem commands', async () => {
    const remoteFile = new File(['pdf content'], 'remote.pdf', { type: 'application/pdf' });

    expect(
      await tryNativeParsePdf('https://example.com/remote.pdf', remoteFile, 'android'),
    ).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('uses a directly opened Android content URI without falling back to pdf.js', async () => {
    const contentUri =
      'content://com.android.externalstorage.documents/document/primary%3ABooks%2Fdocument.pdf';
    const contentFile = Object.assign(
      new File(['pdf content'], 'document.pdf', { type: 'application/pdf' }),
      { getNativeLocation: () => ({ path: contentUri }) },
    );

    await expect(tryNativeParsePdf(contentUri, contentFile, 'android')).resolves.not.toBeNull();
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'parse_pdf_metadata', {
      filePath: contentUri,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'render_pdf_cover', {
      payload: { filePath: contentUri, maxLongEdge: 512 },
    });
  });

  it('keeps the native path when metadata parsing fails but the cover succeeds', async () => {
    invokeMock.mockRejectedValueOnce(new Error('unsupported PDF'));
    const parsed = await tryNativeParsePdf('/sdcard/Books/broken.pdf', undefined, 'android');
    expect(parsed?.partialMd5).toBeUndefined();
    expect(await parsed?.bookDoc.getCover()).toBeInstanceOf(Blob);
  });

  it('rejects instead of falling back to pdf.js when both native readers fail', async () => {
    invokeMock.mockRejectedValue(new Error('unsupported PDF'));
    await expect(
      tryNativeParsePdf('/sdcard/Books/broken.pdf', undefined, 'android'),
    ).rejects.toThrow('Native PDF metadata and cover extraction failed');
  });
});
