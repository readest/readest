import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import StatusInfo from '@/app/reader/components/StatusInfo';

vi.mock('../../../../app/reader/hooks/useCurrentTime', () => ({
  useCurrentTime: () => '09:32',
}));

let batteryLevel = 90;
vi.mock('../../../../app/reader/hooks/useCurrentBattery', () => ({
  useCurrentBatteryStatus: () => batteryLevel,
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

  it('keeps the eink percentage readable where the fill does not reach', () => {
    // In eink mode the fill is opaque base-content but only spans the charged
    // part of the icon. Page-colored text alone vanished over the empty part,
    // so at ~35% the number was invisible. It is drawn in base-content, with a
    // page-colored copy clipped to the fill on top.
    batteryLevel = 35;
    const { container } = render(<StatusInfo {...baseProps} isEink />);
    const labels = container.querySelectorAll<HTMLElement>('.battery-percentage');

    expect(labels).toHaveLength(2);
    const base = labels[0]!;
    const knockout = labels[1]!;
    expect(base.textContent).toBe('35');
    expect(base.classList.contains('text-base-content')).toBe(true);
    expect(knockout.textContent).toBe('35');
    expect(knockout.classList.contains('text-base-100')).toBe(true);
    // Fill ends at 0.5 + 21 * 0.35 = 7.85px of the 25px icon.
    expect(knockout.parentElement?.style.clipPath).toBe('inset(0px 17.15px 0px 0px)');
  });
});
