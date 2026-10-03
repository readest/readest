import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));

import { useKeyDownActions } from '@/hooks/useKeyDownActions';

afterEach(cleanup);

describe('useKeyDownActions', () => {
  // A dialog whose confirm handler closes over state (e.g. "has changes") must
  // get the handler from its latest render, not the one from its first.
  it('calls the latest callbacks after a rerender', () => {
    const first = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const latest = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderHook((props) => useKeyDownActions(props), { initialProps: first });
    rerender(latest);

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(latest.onConfirm).toHaveBeenCalledTimes(1);
    expect(latest.onCancel).toHaveBeenCalledTimes(1);
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(first.onCancel).not.toHaveBeenCalled();
  });
});
