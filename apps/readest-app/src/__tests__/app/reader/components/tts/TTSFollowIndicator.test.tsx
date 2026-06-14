import { cleanup, render, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TTSFollowIndicator from '@/app/reader/components/tts/TTSFollowIndicator';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

describe('TTSFollowIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the following label', () => {
    const { getByText, queryByRole } = render(<TTSFollowIndicator status='following' />);
    expect(getByText('Following audio')).toBeTruthy();
    // following is a status, not an action — must not be a button.
    expect(queryByRole('button')).toBeNull();
  });

  it('appends the estimated suffix for RSVP non-Edge following', () => {
    const { getByText } = render(<TTSFollowIndicator status='following' estimated />);
    expect(getByText('Following audio')).toBeTruthy();
    // getByText normalizes whitespace, so the leading separator space is trimmed.
    expect(getByText(/estimated/)).toBeTruthy();
  });

  it('does not append the estimated suffix when estimated is false', () => {
    const { queryByText } = render(<TTSFollowIndicator status='following' estimated={false} />);
    expect(queryByText(/estimated/)).toBeNull();
  });

  it('renders a Resume audio button that calls onResume when decoupled', () => {
    const onResume = vi.fn();
    const { getByRole, getByText } = render(
      <TTSFollowIndicator status='decoupled' onResume={onResume} />,
    );
    expect(getByText('Resume audio')).toBeTruthy();
    const button = getByRole('button');
    fireEvent.click(button);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows a loading affordance and the following look while syncing', () => {
    const { container, getByText } = render(<TTSFollowIndicator status='syncing' />);
    expect(getByText('Following audio')).toBeTruthy();
    expect(container.querySelector('.loading-dots')).toBeTruthy();
  });

  it('renders nothing when idle', () => {
    const { container } = render(<TTSFollowIndicator status='idle' />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when unsupported', () => {
    const { container } = render(<TTSFollowIndicator status='unsupported' />);
    expect(container.firstChild).toBeNull();
  });

  it('always carries the eink-bordered class so it survives e-ink mode', () => {
    const { container } = render(<TTSFollowIndicator status='following' />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('eink-bordered');
  });
});
