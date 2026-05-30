import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Quota from '@/components/Quota';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

afterEach(() => {
  cleanup();
});

describe('Quota — reset indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" to a fixed UTC instant so reset countdown is deterministic.
    vi.setSystemTime(new Date('2026-05-07T10:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "x% used" and "Resets in h hr m min" when resetAt is set with showProgress', () => {
    // Reset 13 hr 30 min from now (next UTC midnight).
    const resetAt = new Date('2026-05-08T00:00:00Z').getTime();
    render(
      <Quota
        showProgress
        quotas={[
          {
            name: 'Translation Characters',
            tooltip: '',
            used: 25,
            total: 100,
            unit: 'K',
            resetAt,
          },
        ]}
      />,
    );

    expect(screen.getByText('25% used')).toBeTruthy();
    expect(screen.getByText('Resets in 13 hr 30 min')).toBeTruthy();
  });

  it('does not render reset row when resetAt is missing', () => {
    render(
      <Quota
        showProgress
        quotas={[
          {
            name: 'Cloud Sync Storage',
            tooltip: '',
            used: 1,
            total: 10,
            unit: 'GB',
          },
        ]}
      />,
    );

    expect(screen.queryByText(/Resets in/)).toBeNull();
    expect(screen.queryByText(/% used/)).toBeNull();
  });

  it('does not render reset row when showProgress is false', () => {
    const resetAt = new Date('2026-05-08T00:00:00Z').getTime();
    render(
      <Quota
        quotas={[
          {
            name: 'Translation Characters',
            tooltip: '',
            used: 25,
            total: 100,
            unit: 'K',
            resetAt,
          },
        ]}
      />,
    );

    expect(screen.queryByText(/Resets in/)).toBeNull();
  });

  it('clamps the countdown to 0 hr 0 min when resetAt is in the past', () => {
    const resetAt = new Date('2026-05-07T09:00:00Z').getTime(); // 1.5 hr ago
    render(
      <Quota
        showProgress
        quotas={[
          {
            name: 'Translation Characters',
            tooltip: '',
            used: 0,
            total: 100,
            unit: 'K',
            resetAt,
          },
        ]}
      />,
    );

    expect(screen.getByText('Resets in 0 hr 0 min')).toBeTruthy();
  });
});
