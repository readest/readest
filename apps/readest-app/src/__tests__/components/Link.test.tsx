import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockOpenUrl } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: mockOpenUrl,
}));

import Link from '@/components/Link';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockOpenUrl.mockReset();
});

describe('Link', () => {
  it('contains native opener failures', async () => {
    const error = new Error('native opener unavailable');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    mockOpenUrl.mockRejectedValueOnce(error);

    render(<Link href='https://example.com'>Open</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Open' }));

    await waitFor(() => {
      expect(consoleInfo).toHaveBeenCalledWith('Failed to open external link:', error);
    });
  });
});
