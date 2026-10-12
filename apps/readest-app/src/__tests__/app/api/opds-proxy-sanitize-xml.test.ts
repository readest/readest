import { describe, it, expect } from 'vitest';
import { sanitizeXmlBuffer } from '@/app/api/opds/proxy/route';

// The OPDS proxy is unauthenticated and sanitizes the upstream XML body before
// forwarding it. The old sanitizer did `text.slice(i).match(/^&.../)` for every
// `&`, allocating an (n − i)-length substring each time — O(n²) CPU on an
// `&`-heavy body, which an anonymous caller can trigger to burn a Worker's CPU
// budget. The rewrite scans once with an anchored (sticky) regex. These tests
// pin the escaping behavior and guard against the quadratic blow-up returning.

const toText = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

const fromText = (text: string): ArrayBuffer => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes.buffer;
};

describe('sanitizeXmlBuffer', () => {
  it('escapes a bare ampersand', () => {
    expect(toText(sanitizeXmlBuffer(fromText('Tom & Jerry')))).toBe('Tom &amp; Jerry');
  });

  it('leaves already-valid entities untouched', () => {
    const input = 'a &amp; b &lt; c &gt; d &quot; e &apos; f &#39; g &#x1F600;';
    expect(toText(sanitizeXmlBuffer(fromText(input)))).toBe(input);
  });

  it('does not escape ampersands inside CDATA sections', () => {
    const input = '<x><![CDATA[raw & stuff < > ]]></x>';
    expect(toText(sanitizeXmlBuffer(fromText(input)))).toBe(input);
  });

  it('escapes bare ampersands outside CDATA while preserving the CDATA body', () => {
    const input = 'A & B <![CDATA[C & D]]> E & F';
    expect(toText(sanitizeXmlBuffer(fromText(input)))).toBe(
      'A &amp; B <![CDATA[C & D]]> E &amp; F',
    );
  });

  it('handles a large ampersand-heavy body well within a time budget', () => {
    const input = '& '.repeat(200_000); // 400k chars, 200k bare ampersands
    const start = Date.now();
    const out = toText(sanitizeXmlBuffer(fromText(input)));
    const elapsed = Date.now() - start;
    expect(out.startsWith('&amp; &amp; ')).toBe(true);
    // The quadratic version takes many seconds / hangs on this input.
    expect(elapsed).toBeLessThan(2000);
  });
});
