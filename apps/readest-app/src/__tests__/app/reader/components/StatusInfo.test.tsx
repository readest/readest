import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import StatusInfo from '@/app/reader/components/StatusInfo';

vi.mock('../../../../app/reader/hooks/useCurrentTime', () => ({
  useCurrentTime: () => '09:32',
}));

vi.mock('../../../../app/reader/hooks/useCurrentBattery', () => ({
  useCurrentBatteryStatus: () => 90,
}));

const baseProps = {
  showTime: true,
  showBattery: true,
  showBatteryPercentage: true,
};

const renderPercentage = (isEink: boolean) => {
  const { container } = render(<StatusInfo {...baseProps} isEink={isEink} />);
  return container.querySelector('.battery-percentage') as HTMLElement;
};

describe('StatusInfo battery percentage legibility', () => {
  // The percentage sits on the battery fill, which is currentColor at 30%
  // opacity over the page: a mid tone in every theme, so themed base-content
  // text reads against it. An `invert` filter instead flipped the text to the
  // page's own tone -- near-white on a light theme, which vanished (#5045
  // dropped the explicit colors and left only the filter).
  it('uses themed text rather than an inverted filter in non-eink mode', () => {
    const percentage = renderPercentage(false);

    expect(percentage).not.toBeNull();
    expect(percentage.textContent).toBe('90');
    expect(percentage.classList.contains('invert')).toBe(false);
    expect(percentage.classList.contains('text-base-content')).toBe(true);
  });

  it('knocks the percentage out of the solid eink fill', () => {
    // In eink mode the fill is opaque base-content, so the text has to be the
    // page color to stay readable.
    const percentage = renderPercentage(true);

    expect(percentage.classList.contains('invert')).toBe(false);
    expect(percentage.classList.contains('text-base-100')).toBe(true);
  });
});
