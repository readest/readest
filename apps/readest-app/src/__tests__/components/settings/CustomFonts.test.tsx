import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * Synced custom fonts download on demand (issue #6654): a font pulled from
 * the cloud is listed as a cloud-only card until the user taps it.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {}, envConfig: {} }),
}));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({
  queueReplicaBinaryUpload: vi.fn(),
  queueReplicaBinaryDownload: vi.fn(async () => 'transfer-1'),
}));

import CustomFonts from '@/components/settings/CustomFonts';
import { useCustomFontStore } from '@/store/customFontStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTransferStore } from '@/store/transferStore';
import { saveViewSettings } from '@/helpers/settings';
import { queueReplicaBinaryDownload } from '@/services/sync/replicaBinaryUpload';
import type { CustomFont } from '@/styles/fonts';
import type { SystemSettings } from '@/types/settings';

const cloudFont = (overrides: Partial<CustomFont> = {}): CustomFont => ({
  id: 'inter-regular',
  contentId: 'hash-regular',
  name: 'Inter Regular',
  family: 'Inter',
  bundleDir: 'inter-regular',
  path: 'inter-regular/Inter-Regular.ttf',
  unavailable: true,
  ...overrides,
});

beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      globalViewSettings: { defaultFont: 'Sans-serif', serifFont: '', sansSerifFont: '' },
    } as unknown as SystemSettings,
  });
  useTransferStore.setState({ transfers: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CustomFonts download on demand', () => {
  it('marks a family that is not on this device as downloadable', () => {
    useCustomFontStore.setState({ fonts: [cloudFont()] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    expect(screen.getByRole('img', { name: 'Download from Cloud' })).not.toBeNull();
  });

  it('downloads every missing weight of the tapped family and selects it', async () => {
    const bold = cloudFont({ id: 'inter-bold', contentId: 'hash-bold', name: 'Inter Bold' });
    useCustomFontStore.setState({ fonts: [cloudFont(), bold] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));

    await waitFor(() => expect(saveViewSettings).toHaveBeenCalled());
    expect(vi.mocked(queueReplicaBinaryDownload).mock.calls.map(([, f]) => f.name)).toEqual([
      'Inter Regular',
      'Inter Bold',
    ]);
    expect(saveViewSettings).toHaveBeenCalledWith({}, '', 'sansSerifFont', 'Inter');
  });

  it('shows progress while the family is downloading', () => {
    useCustomFontStore.setState({ fonts: [cloudFont()] });
    useTransferStore.getState().addReplicaTransfer('font', 'hash-regular', 'Inter', 'download');
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Downloading…' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Download from Cloud' })).toBeNull();
  });

  it('does not download a family that is already on this device', () => {
    useCustomFontStore.setState({ fonts: [cloudFont({ unavailable: undefined })] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    expect(screen.queryByRole('img', { name: 'Download from Cloud' })).toBeNull();
    fireEvent.click(screen.getByText('Inter'));
    expect(queueReplicaBinaryDownload).not.toHaveBeenCalled();
    expect(saveViewSettings).toHaveBeenCalledWith({}, '', 'sansSerifFont', 'Inter');
  });
});
