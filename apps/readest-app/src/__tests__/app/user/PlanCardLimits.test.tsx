// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import PlanCard from '@/app/user/components/PlanCard';
import { getPlanDetails } from '@/app/user/utils/plan';

const de: Record<string, string> = {
  'Number of Devices': 'Anzahl der Geräte',
  Unlimited: 'Unbegrenzt',
};
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => de[key] ?? key,
}));

afterEach(cleanup);

it("translates a word in the plan's What's Included values", () => {
  render(
    <PlanCard
      plan={getPlanDetails('plus', [])}
      interval='month'
      isUserPlan={false}
      onSubscribe={vi.fn()}
    />,
  );
  const row = screen.getByText('Anzahl der Geräte').parentElement!;
  expect(row.textContent).toBe('Anzahl der GeräteUnbegrenzt');
});
