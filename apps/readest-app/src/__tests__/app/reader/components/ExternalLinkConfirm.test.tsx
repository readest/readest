import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExternalLinkConfirm from '@/app/reader/components/ExternalLinkConfirm';
import { FoliateView } from '@/types/view';

const openExternalUrl = vi.fn();
vi.mock('@/utils/open', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const clickExternalLink = (view: EventTarget, href: string) => {
  const event = new CustomEvent('external-link', { detail: { href }, cancelable: true });
  act(() => {
    view.dispatchEvent(event);
  });
  return event;
};

describe('ExternalLinkConfirm', () => {
  let view: FoliateView;

  beforeEach(() => {
    view = new EventTarget() as unknown as FoliateView;
    openExternalUrl.mockClear();
  });

  afterEach(cleanup);

  it('cancels the default open and asks before following the link', () => {
    render(<ExternalLinkConfirm view={view} />);
    const event = clickExternalLink(view, 'https://example.com/page');

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByText('https://example.com/page')).toBeTruthy();
  });

  it('opens the link once confirmed', () => {
    render(<ExternalLinkConfirm view={view} />);
    clickExternalLink(view, 'https://example.com/page');

    fireEvent.click(screen.getByText('Open'));

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/page');
    expect(screen.queryByText('https://example.com/page')).toBeNull();
  });

  it('does not open the link when cancelled', () => {
    render(<ExternalLinkConfirm view={view} />);
    clickExternalLink(view, 'https://example.com/page');

    fireEvent.click(screen.getByText('Cancel'));

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(screen.queryByText('https://example.com/page')).toBeNull();
  });
});
