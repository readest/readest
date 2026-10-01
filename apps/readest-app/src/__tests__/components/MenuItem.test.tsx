import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

import MenuItem from '@/components/MenuItem';

afterEach(() => cleanup());

// The label always sits behind `mx-2`; the description must start where it does.
test('a description lines up with its label when the item has no icon', () => {
  render(<MenuItem label='Link Book' description='The Hobbit' noIcon />);
  expect(screen.getByText('The Hobbit').style.paddingInlineStart).toBe('0.5rem');
});
