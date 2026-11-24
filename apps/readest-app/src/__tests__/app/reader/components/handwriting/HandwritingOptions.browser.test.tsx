import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import HandwritingOptions from '@/app/reader/components/handwriting/HandwritingOptions';
import { useState } from 'react';

await import('@/styles/globals.css');

const h = vi.hoisted(() => ({ isEink: false }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { isEink: h.isEink } } }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('dir');
});

const Options = ({ marker = false }) => {
  const [width, setWidth] = useState(marker ? 0.03 : 0.006);
  return (
    <div className='eink-bordered bg-base-100 text-base-content inline-flex rounded-2xl p-3'>
      <HandwritingOptions
        tool={marker ? 'marker' : 'pen'}
        color='#1a1a1a'
        width={width}
        onSelectWidth={setWidth}
        onSelectColor={() => {}}
      />
    </div>
  );
};

describe('handwriting width slider in Chromium', () => {
  for (const theme of ['default-light', 'default-dark']) {
    for (const eink of [false, true]) {
      for (const direction of ['ltr', 'rtl']) {
        it(`fits on a phone in ${theme}, eink=${eink}, ${direction}`, async () => {
          await page.viewport(320, 640);
          h.isEink = eink;
          document.documentElement.setAttribute('data-theme', theme);
          document.documentElement.setAttribute('data-eink', String(eink));
          document.documentElement.setAttribute('dir', direction);
          render(<Options />);
          const slider = screen.getByRole('slider', { name: 'Pen Size' }) as HTMLInputElement;
          fireEvent.change(slider, { target: { value: '0.0005' } });
          expect(slider.value).toBe('0.0005');
          expect(slider.getBoundingClientRect().width).toBeGreaterThan(100);
          expect(slider.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
          expect(slider.getBoundingClientRect().right).toBeLessThanOrEqual(320);
          expect(getComputedStyle(slider).display).not.toBe('none');
          expect(screen.queryAllByRole('button', { name: 'Ink Color' })).toHaveLength(eink ? 0 : 5);
        });
      }
    }
  }

  it('keeps the marker broad on a tablet', async () => {
    await page.viewport(1024, 768);
    h.isEink = false;
    render(<Options marker />);
    const slider = screen.getByRole('slider', { name: 'Pen Size' }) as HTMLInputElement;
    expect(slider.min).toBe('0.02');
    fireEvent.change(slider, { target: { value: '0.04' } });
    expect(slider.value).toBe('0.04');
  });
});
