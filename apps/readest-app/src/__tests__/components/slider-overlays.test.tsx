import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import AutoScrollSpeedOverlay from '@/app/reader/components/AutoScrollSpeedOverlay';
import BrightnessOverlay from '@/app/reader/components/BrightnessOverlay';

// Issue #5635: while the swipe gesture adjusts the value, the finger sits on
// or below the capsule, hiding a readout placed under the slider. The value
// must sit at the top of the slider and the icon at the bottom.
const expectValueAboveIcon = (root: HTMLElement, valueText: string) => {
  const capsule = root.querySelector('.flex-col')!;
  expect(capsule).not.toBeNull();
  const children = Array.from(capsule.children);
  const valueIdx = children.findIndex((c) => c.textContent === valueText);
  const trackIdx = children.findIndex((c) => c.classList.contains('h-40'));
  const iconIdx = children.findIndex((c) => c.tagName.toLowerCase() === 'svg');
  expect(valueIdx).toBeGreaterThanOrEqual(0);
  expect(trackIdx).toBeGreaterThanOrEqual(0);
  expect(iconIdx).toBeGreaterThanOrEqual(0);
  expect(valueIdx).toBeLessThan(trackIdx);
  expect(trackIdx).toBeLessThan(iconIdx);
};

describe('vertical slider overlays', () => {
  afterEach(cleanup);

  it('shows the speed value above the slider and the icon below it', () => {
    const { container } = render(<AutoScrollSpeedOverlay visible speed={120} />);
    expectValueAboveIcon(container, '120%');
  });

  it('shows the brightness value above the slider and the icon below it', () => {
    const { container } = render(<BrightnessOverlay visible level={0.4} />);
    expectValueAboveIcon(container, '40');
  });
});
