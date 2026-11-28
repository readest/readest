import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SyncDeviceList from '@/components/SyncDeviceList';
import type { SyncDevice } from '@/utils/syncDevices';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, string>) =>
    value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => options?.[key] ?? ''),
}));

const device = (id: string, client: string | null, os: string | null): SyncDevice => ({
  id,
  client,
  os,
  lastActiveAt: '2026-11-28T00:00:00Z',
  current: false,
});

describe('SyncDeviceList', () => {
  afterEach(cleanup);

  it('names a device by its app alone when the agent names no device', () => {
    render(
      <SyncDeviceList
        devices={[
          device('KOReader|null', 'KOReader', null),
          device('Chrome|macOS', 'Chrome', 'macOS'),
          device('session-id', null, null),
        ]}
        busyId={null}
        onSignOut={() => {}}
      />,
    );
    expect(screen.getByText('KOReader')).toBeTruthy();
    expect(screen.getByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('Unknown device')).toBeTruthy();
  });
});
