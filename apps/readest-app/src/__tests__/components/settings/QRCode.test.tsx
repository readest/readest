import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import QRCode from '@/components/settings/integrations/QRCode';

describe('QRCode', () => {
  it('renders the value as an SVG image', () => {
    const value = 'https://hardcover.app/link?code=ABCD1234';
    const img = render(<QRCode value={value} />).container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe(value);
    expect(decodeURIComponent(img.getAttribute('src')!)).toContain('<svg');
  });
});
