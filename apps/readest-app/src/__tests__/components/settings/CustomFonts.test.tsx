// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * Synced custom fonts download on demand (issue #6654): a font pulled from
 * the cloud is listed as a cloud-only card until the user taps it.
 */

const { env, selectFiles } = vi.hoisted(() => ({
  env: { appService: {} as Record<string, unknown>, envConfig: {} as Record<string, unknown> },
  selectFiles: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => env,
}));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles }),
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({
  queueReplicaBinaryUpload: vi.fn(),
  queueReplicaBinaryDownload: vi.fn(async () => 'transfer-1'),
  queueReplicaBinaryDelete: vi.fn(),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileFontDownload: vi.fn(async () => false),
}));
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

import CustomFonts from '@/components/settings/CustomFonts';
import { useCustomFontStore } from '@/store/customFontStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTransferStore } from '@/store/transferStore';
import { saveViewSettings } from '@/helpers/settings';
import { queueReplicaBinaryDownload } from '@/services/sync/replicaBinaryUpload';
import { runFileFontDownload } from '@/services/sync/file/runLibrarySync';
import { eventDispatcher } from '@/utils/event';
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
  env.appService = {};
  env.envConfig = {};
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

  it('downloads from a file sync backend before Readest Cloud (#7793)', async () => {
    vi.mocked(runFileFontDownload).mockResolvedValueOnce(true);
    useCustomFontStore.setState({ fonts: [cloudFont()] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));

    await waitFor(() => expect(saveViewSettings).toHaveBeenCalled());
    expect(runFileFontDownload).toHaveBeenCalledWith(
      env.envConfig,
      expect.objectContaining({ contentId: 'hash-regular' }),
    );
    expect(queueReplicaBinaryDownload).not.toHaveBeenCalled();
  });

  it('shows progress while a file sync backend downloads the family', async () => {
    vi.mocked(runFileFontDownload).mockReturnValueOnce(new Promise(() => {}));
    useCustomFontStore.setState({ fonts: [cloudFont()] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Downloading…' })).not.toBeNull(),
    );
  });

  it('keeps a later pick when an earlier family finishes downloading', async () => {
    let finishDownload: (done: boolean) => void = () => {};
    vi.mocked(runFileFontDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
    );
    const lora = cloudFont({ id: 'lora', contentId: 'hash-lora', name: 'Lora', family: 'Lora' });
    useCustomFontStore.setState({ fonts: [cloudFont(), { ...lora, unavailable: undefined }] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));
    fireEvent.click(screen.getByText('Lora'));
    finishDownload(true);

    await waitFor(() => expect(screen.queryByRole('status', { name: 'Downloading…' })).toBeNull());
    expect(vi.mocked(saveViewSettings).mock.calls.map(([, , , family]) => family)).toEqual([
      'Lora',
    ]);
  });

  it('keeps the spinner while a repeated pick of the family still downloads', async () => {
    let failFirst: (done: boolean) => void = () => {};
    vi.mocked(runFileFontDownload)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          failFirst = resolve;
        }),
      )
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(queueReplicaBinaryDownload).mockResolvedValueOnce(null);
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    useCustomFontStore.setState({ fonts: [cloudFont()] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));
    fireEvent.click(screen.getByText('Inter'));
    failFirst(false);

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('toast', expect.anything()));
    expect(screen.queryByRole('status', { name: 'Downloading…' })).not.toBeNull();
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

describe('CustomFonts import', () => {
  // Issue #7671: a replica pull starts by reloading the font store from
  // settings. Window focus triggers one, and closing the file picker
  // focuses the window, so a pull can land while a multi-file import is
  // still running. Fonts added before it must already be in settings, or
  // the reload drops them: their files and cloud copies stay behind, and
  // deleting the family later leaves them there.
  it('keeps every imported font when a sync pull reloads the store mid-import', async () => {
    const files = ['OpenDyslexic-Bold.otf', 'OpenDyslexic-Regular.otf'];
    const appService = {
      importFont: vi.fn(async (file: string) => {
        if (file === files[1]) {
          await useCustomFontStore.getState().loadCustomFonts(env.envConfig as never);
        }
        const name = file.replace(/^OpenDyslexic-|\.otf$/g, '');
        return {
          path: `${name}/${file}`,
          bundleDir: name,
          contentId: `hash-${name}`,
          byteSize: 4,
          name: `OpenDyslexic ${name}`,
          family: 'OpenDyslexic',
          style: 'normal',
          weight: name === 'Bold' ? 700 : 400,
          variable: false,
        };
      }),
      openFile: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })),
      saveSettings: vi.fn(async () => {}),
    };
    env.appService = appService;
    env.envConfig = { getAppService: async () => appService };
    useSettingsStore.setState({
      settings: {
        globalViewSettings: { defaultFont: 'Sans-serif', serifFont: '', sansSerifFont: '' },
        customFonts: [],
      } as unknown as SystemSettings,
    });
    useCustomFontStore.setState({ fonts: [] });
    selectFiles.mockResolvedValue({ files: files.map((path) => ({ path })) });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Import Font'));

    await waitFor(() => expect(appService.importFont).toHaveBeenCalledTimes(2));
    const expected = ['OpenDyslexic Bold', 'OpenDyslexic Regular'];
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.customFonts?.map((f) => f.name)).toEqual(
        expected,
      ),
    );
    expect(useCustomFontStore.getState().fonts.map((f) => f.name)).toEqual(expected);
  });
});
