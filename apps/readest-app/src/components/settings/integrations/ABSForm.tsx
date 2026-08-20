import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdCloudSync } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import type { EnvConfigType } from '@/services/environment';
import { useTranslation } from '@/hooks/useTranslation';
import { useABSServerStore } from '@/store/absServerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { ABSClient } from '@/services/audiobookshelf/client';
import { removeAbsServerBooks } from '@/services/audiobookshelf/librarySync';
import { computeAbsServerContentId } from '@/services/sync/adapters/absServer';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import type { ABSLibrary, ABSServer } from '@/types/audiobookshelf';
import type { AppService } from '@/types/system';
import { parseAbsFilePath } from '@/utils/audiobook';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, NavigationRow, SectionTitle, SettingsSwitchRow } from '../primitives';

interface ABSFormProps {
  onBack: () => void;
}

const normalizeAbsUrl = (url: string): string => url.trim().replace(/\/+$/, '');

const isValidAbsUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/**
 * Audiobookshelf integration sub-page. Supports multiple servers, each shown
 * as a row in a boxed list; tapping a row opens that server's management
 * view (rename, library picker, sync now, remove). Mirrors KOSyncForm's
 * connect flow for the single-server empty state.
 */
const ABSForm: React.FC<ABSFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const servers = useABSServerStore((state) => state.servers).filter((server) => !server.deletedAt);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  const activeServer = servers.find((server) => server.id === activeServerId);

  const handleConnect = async () => {
    const trimmedUrl = normalizeAbsUrl(url);
    if (!isValidAbsUrl(trimmedUrl)) {
      setConnectError(_('Server URL must start with http:// or https://'));
      return;
    }
    if (!username || !password) return;

    setIsConnecting(true);
    setConnectError('');

    // id === contentId (see absServerStore.addServer): the id ends up inside
    // every synced book's filePath and hash, so it must be URL-derived and
    // identical on every device, never a local timestamp.
    const draft = {
      name: trimmedUrl.replace(/^https?:\/\//i, ''),
      url: trimmedUrl,
      username,
      password,
    };
    const probe: ABSServer = { id: computeAbsServerContentId(trimmedUrl), ...draft };
    let tokens: Pick<ABSServer, 'accessToken' | 'refreshToken' | 'serverVersion'> = {};

    try {
      const client = new ABSClient(probe, {
        onTokensUpdated: (patch) => {
          tokens = patch;
        },
      });
      await client.login();
      const libraries = await client.getLibraries();
      const syncableLibraryIds = libraries
        .filter((library) => library.mediaType === 'book' || library.mediaType === 'podcast')
        .map((library) => library.id);

      const added = useABSServerStore.getState().addServer({
        ...draft,
        ...tokens,
        libraryIds: syncableLibraryIds,
      });
      void useABSServerStore.getState().saveABSServers(envConfig);
      void eventDispatcher.dispatch('sync-abs-servers', {});

      setUrl('');
      setUsername('');
      setActiveServerId(added.id);
    } catch {
      setConnectError(
        _('Failed to connect to the Audiobookshelf server. Check the URL and credentials.'),
      );
    } finally {
      setIsConnecting(false);
      setPassword('');
    }
  };

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Audiobookshelf')}
        description={_('Sync audiobooks from your Audiobookshelf server into your library.')}
        onBack={onBack}
      />

      {activeServer ? (
        <ABSServerDetail
          server={activeServer}
          envConfig={envConfig}
          appService={appService}
          onBack={() => setActiveServerId(null)}
          onRemoved={() => setActiveServerId(null)}
        />
      ) : (
        <div className='space-y-5'>
          {servers.length > 0 && (
            <BoxedList title={_('Servers')}>
              {servers.map((server) => (
                <NavigationRow
                  key={server.id}
                  title={server.name}
                  status={
                    server.serverVersion
                      ? _('Connected to {{version}}', { version: server.serverVersion })
                      : _('Not connected')
                  }
                  onClick={() => setActiveServerId(server.id)}
                />
              ))}
            </BoxedList>
          )}

          <div className='space-y-4'>
            <SectionTitle>
              {servers.length > 0 ? _('Add Another Server') : _('Add Server')}
            </SectionTitle>
            <form
              className='space-y-4'
              onSubmit={(e) => {
                e.preventDefault();
                handleConnect();
              }}
            >
              <div className='space-y-1.5'>
                <SectionTitle as='label' htmlFor='abs-server-url' className='block'>
                  {_('Server URL')}
                </SectionTitle>
                <input
                  id='abs-server-url'
                  type='text'
                  placeholder='http://audiobookshelf.local:13378'
                  className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                  spellCheck='false'
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setConnectError('');
                  }}
                />
              </div>

              <div className='space-y-1.5'>
                <SectionTitle as='label' htmlFor='abs-username' className='block'>
                  {_('Username')}
                </SectionTitle>
                <input
                  id='abs-username'
                  type='text'
                  placeholder={_('Your Username')}
                  className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                  spellCheck='false'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete='username'
                />
              </div>

              <div className='space-y-1.5'>
                <SectionTitle as='label' htmlFor='abs-password' className='block'>
                  {_('Password')}
                </SectionTitle>
                <input
                  id='abs-password'
                  type='password'
                  placeholder={_('Your Password')}
                  className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete='current-password'
                />
              </div>

              {connectError && <p className='text-error px-0.5 text-[0.85em]'>{connectError}</p>}

              <div className='flex justify-end pt-1'>
                <button
                  type='submit'
                  disabled={isConnecting || !url || !username || !password}
                  className={clsx(
                    'btn btn-contrast',
                    'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                    'focus-visible:ring-base-content/40 focus-visible:outline-none focus-visible:ring-2',
                    isConnecting && 'opacity-60',
                  )}
                >
                  {isConnecting ? (
                    <span className='loading loading-spinner loading-sm' />
                  ) : (
                    _('Connect')
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface ABSServerDetailProps {
  server: ABSServer;
  envConfig: EnvConfigType;
  appService: AppService | null;
  onBack: () => void;
  onRemoved: () => void;
}

const ABSServerDetail: React.FC<ABSServerDetailProps> = ({
  server,
  envConfig,
  appService,
  onBack,
  onRemoved,
}) => {
  const _ = useTranslation();
  const [name, setName] = useState(server.name);
  const [libraries, setLibraries] = useState<ABSLibrary[] | null>(null);
  const [libError, setLibError] = useState('');
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    setName(server.name);
  }, [server.id, server.name]);

  // Re-fetch the library list only when switching to a different server —
  // a checkbox toggle or a name edit republishes `server` with a new object
  // identity (immutable store updates) but must not restart this fetch.
  useEffect(() => {
    let cancelled = false;
    setLibraries(null);
    setLibError('');
    const client = new ABSClient(server, {
      onTokensUpdated: (patch) => {
        useABSServerStore.getState().updateServer(server.id, patch);
        void useABSServerStore.getState().saveABSServers(envConfig);
      },
    });
    client
      .getLibraries()
      .then((libs) => {
        if (cancelled) return;
        setLibraries(
          libs.filter((library) => library.mediaType === 'book' || library.mediaType === 'podcast'),
        );
      })
      .catch(() => {
        if (!cancelled) setLibError(_('Failed to load libraries from the server.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const persist = () => {
    void useABSServerStore.getState().saveABSServers(envConfig);
  };

  const handleNameBlur = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(server.name);
      return;
    }
    if (trimmed === server.name) return;
    useABSServerStore.getState().updateServer(server.id, { name: trimmed });
    persist();
  };

  const handleToggleLibrary = (libraryId: string) => {
    if (!libraries) return;
    const current = server.libraryIds ?? libraries.map((library) => library.id);
    const next = current.includes(libraryId)
      ? current.filter((id) => id !== libraryId)
      : [...current, libraryId];
    useABSServerStore.getState().updateServer(server.id, { libraryIds: next });
    persist();
  };

  const handleSyncNow = () => {
    void eventDispatcher.dispatch('sync-abs-servers', {});
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    // A live session outlives the server row: `getServer` still resolves a
    // tombstoned server, so the player would keep streaming and syncing
    // progress to a server the user just deleted. Stop it first.
    const active = ttsSessionManager.getActiveSession();
    if (active) {
      const playing = useLibraryStore
        .getState()
        .library.find((book) => book.hash === active.bookHash);
      if (parseAbsFilePath(playing?.filePath)?.serverId === server.id) {
        await ttsSessionManager.stopActive('deleted');
      }
    }
    useABSServerStore.getState().removeServer(server.id);
    persist();
    if (appService) {
      await removeAbsServerBooks(appService, server.id);
    }
    setIsRemoving(false);
    onRemoved();
  };

  const selectedIds = server.libraryIds ?? libraries?.map((library) => library.id) ?? [];

  return (
    <div className='space-y-5'>
      <button
        type='button'
        onClick={onBack}
        className='text-base-content/70 hover:text-primary -mt-2 px-4 text-[0.85em] transition-colors duration-150 focus-visible:underline focus-visible:outline-none'
      >
        {_('All Servers')}
      </button>

      <div className='space-y-1.5'>
        <SectionTitle as='label' htmlFor='abs-server-name' className='block'>
          {_('Name')}
        </SectionTitle>
        <input
          id='abs-server-name'
          type='text'
          className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
        />
      </div>

      <div className='space-y-1.5'>
        <SectionTitle as='label' className='block'>
          {_('Server URL')}
        </SectionTitle>
        <input
          type='text'
          disabled
          className='input input-bordered eink-bordered h-11 w-full text-sm opacity-70'
          value={server.url}
        />
      </div>

      <div className='space-y-0.5 px-4'>
        {server.serverVersion && (
          <p className='text-base-content/65 text-[0.85em]'>
            {_('Connected to {{version}}', { version: server.serverVersion })}
          </p>
        )}
        <p className='text-base-content/65 text-[0.85em]'>
          {server.lastSyncedAt
            ? _('Last synced {{time}}', { time: new Date(server.lastSyncedAt).toLocaleString() })
            : _('Never synced')}
        </p>
      </div>

      <div className='space-y-2'>
        <SectionTitle>{_('Libraries to Sync')}</SectionTitle>
        {libError ? (
          <p className='text-error px-4 text-[0.85em]'>{libError}</p>
        ) : libraries === null ? (
          <div className='flex justify-center py-4'>
            <span className='loading loading-spinner loading-sm' />
          </div>
        ) : libraries.length === 0 ? (
          <p className='text-base-content/65 px-4 text-[0.85em]'>
            {_('No book libraries found on this server.')}
          </p>
        ) : (
          <BoxedList>
            {libraries.map((library) => (
              <SettingsSwitchRow
                key={library.id}
                label={library.name}
                checked={selectedIds.includes(library.id)}
                onChange={() => handleToggleLibrary(library.id)}
              />
            ))}
          </BoxedList>
        )}
      </div>

      <div className='flex items-center justify-between gap-3 pt-1'>
        <button
          type='button'
          onClick={handleSyncNow}
          className='btn btn-ghost btn-sm h-9 min-h-9 gap-1.5'
        >
          <MdCloudSync className='h-4 w-4' />
          {_('Sync Now')}
        </button>
        <button
          type='button'
          onClick={handleRemove}
          disabled={isRemoving}
          className={clsx(
            'eink-bordered',
            'h-9 rounded-lg px-4 text-sm font-medium',
            'text-error hover:bg-error/10',
            'transition-colors duration-150',
            'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
            isRemoving && 'opacity-60',
          )}
        >
          {_('Remove Server')}
        </button>
      </div>
    </div>
  );
};

export default ABSForm;
