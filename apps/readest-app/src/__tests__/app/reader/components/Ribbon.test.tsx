import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import Ribbon from '@/app/reader/components/Ribbon';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 48, right: 0, bottom: 0, left: 0 } }),
}));

describe('Ribbon', () => {
  it('stacks above the scrolled-mode notch mask so the full ribbon stays visible', () => {
    // In scrolled mode SectionInfo paints a `bg-base-100` `notch-area` mask over the
    // top safe-area strip at z-10. The ribbon renders earlier in the DOM, so it must
    // sit on a higher layer than z-10 or its upper (unsafe-area) half gets covered.
    const { container } = render(<Ribbon width='5%' />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;

    expect(ribbon).not.toBeNull();
    expect(ribbon.classList.contains('z-10')).toBe(false);
    expect(ribbon.classList.contains('z-20')).toBe(true);
    // Decorative only: taps must fall through to the notch mask's scroll-to-top.
    expect(ribbon.classList.contains('pointer-events-none')).toBe(true);
  });

  it('spans the safe-area inset plus the header bar height', () => {
    const { container } = render(<Ribbon width='5%' />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;

    expect(ribbon.style.height).toBe('92px'); // 48px safe-area top + 44px header bar
  });
});
