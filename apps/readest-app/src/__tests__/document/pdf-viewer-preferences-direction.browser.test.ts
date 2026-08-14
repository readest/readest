import { describe, expect, it } from 'vitest';

import { makePDF } from 'foliate-js/pdf.js';

// PDFs bound right-to-left (Japanese photo books, manga) declare it in the
// catalog's ViewerPreferences as /Direction /R2L. makePDF must surface that as
// book.dir so the fixed-layout renderer pairs and orders spreads right-to-left
// without the user hunting for the writing-mode setting (readest#5591).

// Minimal two-page PDFs generated with pypdf; the first carries
// /ViewerPreferences << /Direction /R2L >>, the second no viewer preferences.
const R2L_PDF_BASE64 =
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDIKL0tpZHMgWyA0IDAgUiA1IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgovVmlld2VyUHJlZmVyZW5jZXMgPDwKL0RpcmVjdGlvbiAvUjJMCj4+Cj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMzAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgMjAwIDMwMCBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTkgMDAwMDAgbiAKMDAwMDAwMDIwOSAwMDAwMCBuIAowMDAwMDAwMzAzIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgo+PgpzdGFydHhyZWYKMzk3CiUlRU9GCg==';

const PLAIN_PDF_BASE64 =
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDIKL0tpZHMgWyA0IDAgUiA1IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgMjAwIDMwMCBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1Jlc291cmNlcyA8PAo+PgovTWVkaWFCb3ggWyAwLjAgMC4wIDIwMCAzMDAgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTE5IDAwMDAwIG4gCjAwMDAwMDAxNjggMDAwMDAgbiAKMDAwMDAwMDI2MiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjM1NgolJUVPRgo=';

const toFile = (base64: string, name: string): File => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: 'application/pdf' });
};

type PDFBook = { dir?: string; destroy?: () => void };

describe('makePDF viewer preferences direction', () => {
  it('marks PDFs declaring /Direction /R2L as rtl', async () => {
    const book = (await makePDF(toFile(R2L_PDF_BASE64, 'r2l.pdf'))) as PDFBook;
    try {
      expect(book.dir).toBe('rtl');
    } finally {
      book.destroy?.();
    }
  });

  it('leaves PDFs without a direction preference alone', async () => {
    const book = (await makePDF(toFile(PLAIN_PDF_BASE64, 'plain.pdf'))) as PDFBook;
    try {
      expect(book.dir).toBeUndefined();
    } finally {
      book.destroy?.();
    }
  });
});
