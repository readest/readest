import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import type { ABSLibrary } from '@/types/audiobookshelf';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';

// vi.mock factories are hoisted above const initializers, so shared spies and
// fixtures referenced eagerly inside a factory MUST come from vi.hoisted() —
// plain top-level consts throw "cannot access before initialization".
const mocks = vi.hoisted(() => {
  const libraries: ABSLibrary[] = [
    { id: 'lib1', name: 'Fiction', mediaType: 'book' },
    { id: 'lib2', name: 'Sci-Fi', mediaType: 'book' },
    { id: 'lib3', name: 'Podcasts', mediaType: 'podcast' },
  ];
  return {
    saveSettings: vi.fn(async () => {}),
    removeAbsServerBooks: vi.fn(async () => {}),
    getActiveSession: vi.fn((): { bookHash: string } | null => null),
    stopActive: vi.fn(async (_reason?: string) => {}),
    appService: {} as AppService,
    libraries,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings: mocks.saveSettings }) },
    appService: mocks.appService,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

// absServerStore publishes replica upserts/deletes from its mutators; not
// exercised here (no replica sync initialized in jsdom), but the module
// still imports replicaPublish at load time, same as abs-server-store.test.ts.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

vi.mock('@/services/audiobookshelf/librarySync', () => ({
  removeAbsServerBooks: mocks.removeAbsServerBooks,
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getActiveSession: mocks.getActiveSession,
    stopActive: mocks.stopActive,
  },
}));

vi.mock('@/services/audiobookshelf/client', () => ({
  ABSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _server: unknown,
    callbacks: { onTokensUpdated: (patch: Record<string, unknown>) => void },
  ) {
    Object.assign(this, {
      login: vi.fn(async () => {
        callbacks.onTokensUpdated({
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          serverVersion: '2.36.0',
        });
      }),
      getLibraries: vi.fn(async () => mocks.libraries),
    });
  }),
}));

import ABSForm from '@/components/settings/integrations/ABSForm';
import { useLibraryStore } from '@/store/libraryStore';
import { computeAbsServerContentId } from '@/services/sync/adapters/absServer';
import { makeAbsFilePath } from '@/utils/audiobook';
import type { Book } from '@/types/book';

const settings = { absServers: [] } as unknown as SystemSettings;

const SERVER_URL = 'http://abs.local:13378';
const SERVER_ID = computeAbsServerContentId(SERVER_URL);

const absBook = (hash: string, serverId: string): Book => ({
  hash,
  format: 'ABS',
  filePath: makeAbsFilePath(serverId, 'item-1'),
  title: 'Audiobook',
  author: 'Author',
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings } as never);
  useABSServerStore.setState({ servers: [] });
  useLibraryStore.setState({ library: [] });
  mocks.getActiveSession.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

const fillAndConnect = () => {
  fireEvent.change(screen.getByLabelText('Server URL'), {
    target: { value: SERVER_URL },
  });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
};

describe('ABSForm', () => {
  test('renders the empty-state connect form when no server is configured', () => {
    render(<ABSForm onBack={vi.fn()} />);
    expect(screen.getByLabelText('Server URL')).not.toBeNull();
    expect(screen.getByLabelText('Username')).not.toBeNull();
    expect(screen.getByLabelText('Password')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeNull();
  });

  test('a successful connect stores the server and renders the library checkbox list', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(1);
    });
    const server = useABSServerStore.getState().getAvailableServers()[0]!;
    expect(server.accessToken).toBe('at-1');
    expect(server.libraryIds).toEqual(['lib1', 'lib2', 'lib3']);
    expect(server.username).toBe('alice');
    expect(server.password).toBe('hunter2');

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Fiction' })).not.toBeNull();
    });
    expect(screen.getByRole('checkbox', { name: 'Sci-Fi' })).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Podcasts' })).not.toBeNull();
  });

  test('toggling a library checkbox updates server.libraryIds', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Fiction' })).not.toBeNull();
    });

    const fictionCheckbox = screen.getByRole('checkbox', { name: 'Fiction' });
    expect((fictionCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(fictionCheckbox);

    await waitFor(() => {
      const server = useABSServerStore.getState().getAvailableServers()[0]!;
      expect(server.libraryIds).toEqual(['lib2', 'lib3']);
    });
  });

  test('Remove Server soft-deletes the server and returns to the empty state', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Server' })).not.toBeNull();
    });
    const serverId = useABSServerStore.getState().getAvailableServers()[0]!.id;

    fireEvent.click(screen.getByRole('button', { name: 'Remove Server' }));

    await waitFor(() => {
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(0);
    });
    expect(mocks.removeAbsServerBooks).toHaveBeenCalledWith(mocks.appService, serverId);

    await waitFor(() => {
      expect(screen.getByLabelText('Server URL')).not.toBeNull();
    });
  });

  // The id ends up inside every synced book's filePath (abs://<serverId>/<id>)
  // and therefore its hash, so it must be URL-derived, not a local timestamp.
  test('a connected server is keyed by its URL-derived contentId, not a local timestamp', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(1);
    });
    const server = useABSServerStore.getState().getAvailableServers()[0]!;
    expect(server.id).toBe(SERVER_ID);
    expect(server.id).toBe(server.contentId);
  });

  test('Remove Server stops a live session for one of its books before removing', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Server' })).not.toBeNull();
    });

    useLibraryStore.setState({ library: [absBook('h-live', SERVER_ID)] });
    mocks.getActiveSession.mockReturnValue({ bookHash: 'h-live' });
    // The server must still be resolvable while the session tears down: its
    // progress flush and stream URLs both go through the store entry.
    let serverAliveAtStop = false;
    mocks.stopActive.mockImplementation(async () => {
      serverAliveAtStop = useABSServerStore.getState().getAvailableServers().length === 1;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Server' }));

    await waitFor(() => {
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(0);
    });
    expect(mocks.stopActive).toHaveBeenCalledWith('deleted');
    expect(serverAliveAtStop).toBe(true);
  });

  test('Remove Server leaves a session belonging to another server alone', async () => {
    render(<ABSForm onBack={vi.fn()} />);
    fillAndConnect();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Server' })).not.toBeNull();
    });

    useLibraryStore.setState({ library: [absBook('h-other', 'some-other-server')] });
    mocks.getActiveSession.mockReturnValue({ bookHash: 'h-other' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Server' }));

    await waitFor(() => {
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(0);
    });
    expect(mocks.stopActive).not.toHaveBeenCalled();
  });
});
