import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

const h = vi.hoisted(() => ({
  validateToken: vi.fn(),
  resolveDataSourceId: vi.fn(),
  saveSettings: vi.fn(async () => {}),
  dispatch: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings: h.saveSettings }) },
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: h.dispatch } }));
vi.mock('@/services/notion', async (original) => {
  const actual = await original<typeof import('@/services/notion')>();
  return {
    ...actual,
    NotionClient: class {
      validateToken() {
        return h.validateToken();
      }
      resolveDataSourceId(id: string) {
        return h.resolveDataSourceId(id);
      }
    },
  };
});

import NotionForm from '@/components/settings/integrations/NotionForm';

const objectId = '1234567890abcdef1234567890abcdef';
const resolvedId = 'abcdefabcdefabcdefabcdefabcdefab';
const disconnected = {
  notion: {
    enabled: false,
    accessToken: '',
    databaseId: '',
    lastSyncedAt: 0,
    includeChapterHeading: true,
  },
} as unknown as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
  h.validateToken.mockResolvedValue({ valid: true });
  h.resolveDataSourceId.mockResolvedValue({ success: true, dataSourceId: resolvedId });
  useSettingsStore.setState({ settings: disconnected } as never);
});

afterEach(cleanup);

describe('NotionForm connection validation', () => {
  test('resolves and saves a shared data source instead of accepting token-only validation', async () => {
    render(<NotionForm onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Access Token'), { target: { value: ' secret_test ' } });
    fireEvent.change(screen.getByLabelText('Database ID'), {
      target: { value: `https://notion.so/Workspace-${objectId}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(h.resolveDataSourceId).toHaveBeenCalledWith(objectId));
    expect(h.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        notion: expect.objectContaining({
          enabled: true,
          accessToken: 'secret_test',
          databaseId: resolvedId,
        }),
      }),
    );
  });

  test('does not save when the database is not shared with the integration', async () => {
    h.resolveDataSourceId.mockResolvedValue({
      success: false,
      code: 'invalid_target',
      message: 'not shared',
    });
    render(<NotionForm onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Access Token'), { target: { value: 'secret_test' } });
    fireEvent.change(screen.getByLabelText('Database ID'), { target: { value: objectId } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(h.resolveDataSourceId).toHaveBeenCalled());
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({
        message: 'The Notion database is unavailable or has not been shared with this integration.',
        type: 'error',
      }),
    );
  });
});
