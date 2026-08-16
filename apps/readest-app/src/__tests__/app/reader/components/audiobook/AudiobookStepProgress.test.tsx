import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import StepProgress from '@/app/reader/components/audiobook/AudiobookStepProgress';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

describe('Audiobook StepProgress', () => {
  it('uses daisyUI steps and marks progress through the current step', () => {
    const { getByRole } = render(<StepProgress current={2} />);

    const progress = getByRole('progressbar', { name: 'Audiobook pairing progress' });
    const steps = progress.querySelectorAll('li.step');

    expect(progress.classList.contains('steps')).toBe(true);
    expect(progress.classList.contains('steps-horizontal')).toBe(true);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.classList.contains('step-neutral')).toBe(true);
    expect(steps[1]?.classList.contains('step-neutral')).toBe(true);
    expect(steps[2]?.classList.contains('step-neutral')).toBe(false);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(Array.from(steps, (step) => step.textContent)).toEqual(['Files', 'Align', 'Review']);
  });
});
