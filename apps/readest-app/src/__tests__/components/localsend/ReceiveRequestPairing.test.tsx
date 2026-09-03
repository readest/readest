import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

/**
 * The pairing opt-in on an incoming Nearby BookDrop request.
 *
 * The locked (no entitlement) variant must stay legible: daisyUI drops a
 * `disabled` box to `opacity: .2` on top of an already 20%-opacity border, so
 * marking it disabled made the control indistinguishable from the dialog
 * surface. The row itself is the control, so the box is decorative.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { osPlatform: 'macos' } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 } }),
}));

const quota = { userProfilePlan: 'free' as string | undefined, customizationPurchased: false };
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => quota }));

import ReceiveRequestDialog from '@/components/localsend/ReceiveRequestDialog';
import en from '../../../../public/locales/en/translation.json';

const request = {
  sessionId: 's1',
  sender: {
    alias: 'Readest',
    deviceModel: 'macOS',
    deviceType: 'desktop',
    fingerprint: 'fp',
    certVerified: true,
  },
  files: [
    { id: 'f1', fileName: 'Moby-Dick.epub', size: 1_550_000, fileType: 'epub', preview: null },
  ],
};

const renderDialog = () =>
  render(
    <ReceiveRequestDialog request={request as never} onAccept={vi.fn()} onDecline={vi.fn()} />,
  );

afterEach(() => {
  cleanup();
  quota.userProfilePlan = 'free';
  quota.customizationPurchased = false;
});

describe('ReceiveRequestDialog pairing opt-in', () => {
  it('offers a single opt-in, with no separate "accept once" choice', () => {
    quota.customizationPurchased = true;
    renderDialog();
    expect(screen.getByText('Always accept from Readest')).toBeTruthy();
    expect(screen.queryByText('Accept once')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('keeps the locked box at full opacity rather than marking it disabled', () => {
    renderDialog();
    expect(screen.getByText('Premium')).toBeTruthy();
    const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(box).not.toBeNull();
    // `disabled` is what triggers daisyUI's opacity:.2 washout.
    expect(box!.disabled).toBe(false);
    expect(box!.checked).toBe(false);
    expect(box!.className).toContain('border-base-content/45');
  });

  it('passes the book count to the title so i18next can pluralise it', () => {
    renderDialog();
    // The mock translator only interpolates, so this proves `count` reaches
    // the key; the plural forms themselves are asserted below.
    expect(screen.getByText('Readest wants to send you 1 book(s)')).toBeTruthy();
    // The total size used to be repeated here even though every row shows one.
    expect(screen.queryByText(/1 book\(s\), /)).toBeNull();
  });

  it('ships English plural forms for the title, or it renders as "1 book(s)"', () => {
    const key = '{{alias}} wants to send you {{count}} book(s)';
    expect(en[`${key}_one` as keyof typeof en]).toBe('{{alias}} wants to send you {{count}} book');
    expect(en[`${key}_other` as keyof typeof en]).toBe(
      '{{alias}} wants to send you {{count}} books',
    );
  });
});
