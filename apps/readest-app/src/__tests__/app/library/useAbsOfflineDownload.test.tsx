import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { UserPlan } from '@/types/quota';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  plan: 'free' as UserPlan | undefined,
  customizationPurchased: false,
}));
const queueAbsOfflineDownload = vi.hoisted(() => vi.fn(() => 'transfer-1'));
const navigateToLogin = vi.hoisted(() => vi.fn());
const navigateToProfile = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    userProfilePlan: state.plan,
    customizationPurchased: state.customizationPurchased,
  }),
}));
vi.mock('@/services/transferManager', () => ({
  transferManager: { queueAbsOfflineDownload },
}));
vi.mock('@/utils/nav', () => ({ navigateToLogin, navigateToProfile }));

const { useAbsOfflineDownload } = await import('@/app/library/hooks/useAbsOfflineDownload');

const book = { hash: 'h1', format: 'ABS', title: 'Alice' } as Book;

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'u1' };
  state.plan = 'free';
  state.customizationPurchased = false;
});

describe('useAbsOfflineDownload', () => {
  it('queues the download for a premium user', () => {
    state.plan = 'plus';
    const { result } = renderHook(() => useAbsOfflineDownload());

    expect(result.current.offlinePremiumLabel).toBeUndefined();
    result.current.handleBookOfflineDownload(book);

    expect(queueAbsOfflineDownload).toHaveBeenCalledWith(book, 1);
  });

  it('routes a free user to the upgrade page', () => {
    const { result } = renderHook(() => useAbsOfflineDownload());

    expect(result.current.offlinePremiumLabel).toBe('Premium');
    result.current.handleBookOfflineDownload(book);

    expect(queueAbsOfflineDownload).not.toHaveBeenCalled();
    expect(navigateToProfile).toHaveBeenCalled();
  });

  it('routes a signed-out user to sign in', () => {
    state.user = null;
    state.plan = undefined;
    const { result } = renderHook(() => useAbsOfflineDownload());

    expect(result.current.offlinePremiumLabel).toBe('Premium');
    result.current.handleBookOfflineDownload(book);

    expect(navigateToLogin).toHaveBeenCalled();
    expect(queueAbsOfflineDownload).not.toHaveBeenCalled();
  });

  it('shows no Premium label while a signed-in plan is still loading', () => {
    state.plan = undefined;
    const { result } = renderHook(() => useAbsOfflineDownload());

    expect(result.current.offlinePremiumLabel).toBeUndefined();
  });
});
