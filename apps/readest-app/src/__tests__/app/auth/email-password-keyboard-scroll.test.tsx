import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import EmailPasswordAuth from '@/app/auth/components/EmailPasswordAuth';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const supabaseMock = {
  auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
} as unknown as SupabaseClient;

class VisualViewportStub extends EventTarget {
  height = 872;
  offsetTop = 0;
  emitResize(height: number, offsetTop = 0) {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

let vv: VisualViewportStub;

describe('EmailPasswordAuth keyboard visibility (#5499 follow-up)', () => {
  beforeEach(() => {
    vv = new VisualViewportStub();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 872,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('adds a scroll spacer matching the keyboard inset while the keyboard is open', () => {
    const { container } = render(<EmailPasswordAuth supabaseClient={supabaseMock} />);
    expect(container.querySelector('[data-keyboard-spacer]')).toBeNull();

    act(() => {
      vv.emitResize(535);
    });
    const spacer = container.querySelector('[data-keyboard-spacer]') as HTMLElement;
    expect(spacer).toBeTruthy();
    expect(spacer.style.height).toBe('337px');

    act(() => {
      vv.emitResize(872);
    });
    expect(container.querySelector('[data-keyboard-spacer]')).toBeNull();
  });

  it('scrolls the focused input into view after the keyboard settles', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { container } = render(<EmailPasswordAuth supabaseClient={supabaseMock} />);
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;

    fireEvent.focus(password);
    password.focus();
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });

  it('does not scroll an input whose focus already moved elsewhere', () => {
    vi.useFakeTimers();
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };

    const { container } = render(<EmailPasswordAuth supabaseClient={supabaseMock} />);
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;

    password.focus();
    email.focus();
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(scrolled).not.toContain(password);
    expect(scrolled).toContain(email);
  });
});
