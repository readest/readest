// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import QRCode, { getQRCodeDataUrl } from '@/components/settings/integrations/QRCode';

describe('QRCode', () => {
  it('rejects a selection larger than the encoder can represent', () => {
    expect(() => getQRCodeDataUrl('文'.repeat(2000))).toThrow();
  });

  it('renders the value as an SVG image', () => {
    const value = 'https://hardcover.app/link?code=ABCD1234';
    const img = render(<QRCode value={value} />).container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe(value);
    expect(decodeURIComponent(img.getAttribute('src')!)).toContain('<svg');
  });
});
