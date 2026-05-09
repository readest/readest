'use client';

import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import {
  IoAdd,
  IoTrash,
  IoOpenOutline,
  IoBook,
  IoEyeOff,
  IoEye,
  IoPencil,
  IoCloudDownloadOutline,
} from 'react-icons/io5';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { ensurePassphraseUnlocked } from '@/services/sync/passphraseGate';
import { isSyncError } from '@/libs/errors';
import { OPDSCatalog } from '@/types/opds';
import { isLanAddress } from '@/utils/network';
import { eventDispatcher } from '@/utils/event';
import { deleteSubscriptionState, loadSubscriptionState } from '@/services/opds';
import type { OPDSSubscriptionState } from '@/services/opds/types';
import { validateOPDSURL } from '../utils/opdsUtils';
import { FailedDownloadsDialog } from './FailedDownloadsDialog';
import {
  formatOPDSCustomHeadersInput,
  hasOPDSCustomHeaders,
  parseOPDSCustomHeadersInput,
} from '../utils/customHeaders';
import ModalPortal from '@/components/ModalPortal';

const POPULAR_CATALOGS: OPDSCatalog[] = [
  {
    id: 'gutenberg',
    name: 'Project Gutenberg',
    url: 'https://m.gutenberg.org/ebooks.opds/',
    description: "World's largest collection of free ebooks",
    icon: '🏛️',
  },
  {
    id: 'standardebooks',
    name: 'Standard Ebooks',
    url: 'https://standardebooks.org/feeds/opds',
    description: 'Free and liberated ebooks, carefully produced for the true book lover',
    icon: '📚',
  },
  {
    id: 'manybooks',
    name: 'ManyBooks',
    url: 'https://manybooks.net/opds/index.php',
    description: 'Over 50,000 free ebooks',
    icon: '📖',
  },
  {
    id: 'unglue.it',
    name: 'Unglue.it',
    url: 'https://unglue.it/api/opds/',
    description: 'Free ebooks from authors who have "unglued" their books',
    icon: '🔓',
  },
];

async function validateOPDSCatalog(
  url: string,
  username?: string,
  password?: string,
  customHeaders?: Record<string, string>,
): Promise<{ valid: boolean; error?: string }> {
  const result = await validateOPDSURL(url, username, password, isWebAppPlatform(), customHeaders);
  return { valid: result.isValid, error: result.error };
}

const EMPTY_NEW_CATALOG = {
  name: '',
  url: '',
  description: '',
  username: '',
  password: '',
  customHeadersInput: '',
  proxyConsent: false,
  autoDownload: false,
};

export function CatalogManager() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  // Hydrate the store from settings on mount; all CRUD goes through it
  // so the replica-sync push fires automatically. The local `catalogs`
  // mirror tracks the visible (non-deleted) entries; we keep the
  // setState wrapper so `useEffect` consumers (subscriptions) re-fire
  // when the list changes.
  const allCatalogs = useCustomOPDSStore((s) => s.catalogs);
  const [catalogs, setCatalogs] = useState<OPDSCatalog[]>(() =>
    useCustomOPDSStore.getState().getAvailableCatalogs(),
  );
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [newCatalog, setNewCatalog] = useState(EMPTY_NEW_CATALOG);
  const [showPassword, setShowPassword] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [headerError, setHeaderError] = useState('');
  const [proxyConsentError, setProxyConsentError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const popularCatalogs = appService?.isOnlineCatalogsAccessible ? POPULAR_CATALOGS : [];
  const [subscriptionStates, setSubscriptionStates] = useState<
    Record<string, OPDSSubscriptionState>
  >({});
  const [failedDialogCatalogId, setFailedDialogCatalogId] = useState<string | null>(null);

  const reloadSubscriptionStates = useCallback(async () => {
    if (!appService) return;
    const eligible = catalogs.filter((c) => c.autoDownload);
    const entries = await Promise.all(
      eligible.map(async (c) => [c.id, await loadSubscriptionState(appService, c.id)] as const),
    );
    setSubscriptionStates(Object.fromEntries(entries));
  }, [appService, catalogs]);

  useEffect(() => {
    reloadSubscriptionStates();
  }, [reloadSubscriptionStates]);

  useEffect(() => {
    const handler = () => {
      reloadSubscriptionStates();
    };
    eventDispatcher.on('opds-sync-complete', handler);
    return () => eventDispatcher.off('opds-sync-complete', handler);
  }, [reloadSubscriptionStates]);
  const hasSensitiveWebOPDSInput =
    newCatalog.username.trim().length > 0 ||
    newCatalog.password.trim().length > 0 ||
    newCatalog.customHeadersInput.trim().length > 0;
  const isWebCatalogProxyWarningRequired = isWebAppPlatform() && hasSensitiveWebOPDSInput;

  // Hydrate from settings + persist when the store mutates. Loading
  // happens once per mount; the store handles backfilling contentId
  // for legacy entries.
  useEffect(() => {
    void useCustomOPDSStore.getState().loadCustomOPDSCatalogs(envConfig);
  }, [envConfig]);

  // Surface the latest store state into the local mirror used by
  // subscriptions / dialog rendering. Filters out tombstones.
  useEffect(() => {
    setCatalogs(allCatalogs.filter((c) => !c.deletedAt));
  }, [allCatalogs]);

  // Persist via the store (settings + replica push), then update local
  // mirror. Replica sync fan-out happens inside the store mutators.
  const persistMutation = () => {
    void useCustomOPDSStore.getState().saveCustomOPDSCatalogs(envConfig);
  };

  const handleAddCatalog = async () => {
    if (!newCatalog.name || !newCatalog.url) return;

    const parsedHeaders = parseOPDSCustomHeadersInput(newCatalog.customHeadersInput);
    if (parsedHeaders.error) {
      setHeaderError(parsedHeaders.error);
      return;
    }

    const urlLower = newCatalog.url.trim().toLowerCase();
    if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
      setUrlError(_('URL must start with http:// or https://'));
      return;
    }

    if (
      process.env['NODE_ENV'] === 'production' &&
      isWebAppPlatform() &&
      isLanAddress(newCatalog.url)
    ) {
      setUrlError(_('Adding LAN addresses is not supported in the web app version.'));
      return;
    }

    if (isWebCatalogProxyWarningRequired && !newCatalog.proxyConsent) {
      setProxyConsentError(
        _(
          'Please confirm that this OPDS connection will be proxied through Readest servers on the web app before continuing.',
        ),
      );
      return;
    }

    setIsValidating(true);
    setUrlError('');
    setHeaderError('');
    setProxyConsentError('');

    const validation = await validateOPDSCatalog(
      newCatalog.url,
      newCatalog.username || undefined,
      newCatalog.password || undefined,
      parsedHeaders.headers,
    );

    if (!validation.valid) {
      setUrlError(validation.error || _('Invalid OPDS catalog. Please check the URL.'));
      setIsValidating(false);
      return;
    }

    const customHeaders = hasOPDSCustomHeaders(parsedHeaders.headers)
      ? parsedHeaders.headers
      : undefined;

    // If the user provided credentials, unlock (or set up) the sync
    // passphrase BEFORE saving. The crypto middleware drops creds
    // from the push when the session is locked, so this gate is what
    // turns the credentials into actual cross-device sync. User
    // cancel = save proceeds without sync (the catalog still works
    // locally with the entered creds).
    const hasCredentials = !!(newCatalog.username || newCatalog.password);
    if (hasCredentials) {
      try {
        await ensurePassphraseUnlocked();
      } catch (err) {
        if (!(isSyncError(err) && err.code === 'NO_PASSPHRASE')) {
          // Surface unexpected errors; cancel-by-user is silent.
          setUrlError(err instanceof Error ? err.message : String(err));
          setIsValidating(false);
          return;
        }
        // User cancelled the prompt — save locally without encrypted sync.
      }
    }

    if (editingCatalogId) {
      useCustomOPDSStore.getState().updateCatalog(editingCatalogId, {
        name: newCatalog.name,
        url: newCatalog.url,
        description: newCatalog.description || undefined,
        username: newCatalog.username || undefined,
        password: newCatalog.password || undefined,
        customHeaders,
        autoDownload: newCatalog.autoDownload || undefined,
      });
    } else {
      useCustomOPDSStore.getState().addCatalog({
        id: Date.now().toString(),
        name: newCatalog.name,
        url: newCatalog.url,
        description: newCatalog.description || undefined,
        username: newCatalog.username || undefined,
        password: newCatalog.password || undefined,
        customHeaders,
        autoDownload: newCatalog.autoDownload || undefined,
      });
    }
    persistMutation();

    setNewCatalog(EMPTY_NEW_CATALOG);
    setUrlError('');
    setHeaderError('');
    setProxyConsentError('');
    setIsValidating(false);
    setEditingCatalogId(null);
    setShowAddDialog(false);
  };

  const handleEditCatalog = (catalog: OPDSCatalog) => {
    setNewCatalog({
      name: catalog.name,
      url: catalog.url,
      description: catalog.description || '',
      username: catalog.username || '',
      password: catalog.password || '',
      customHeadersInput: formatOPDSCustomHeadersInput(catalog.customHeaders),
      proxyConsent: false,
      autoDownload: catalog.autoDownload || false,
    });
    setEditingCatalogId(catalog.id);
    setShowAddDialog(true);
  };

  const handleAddPopularCatalog = (popularCatalog: OPDSCatalog) => {
    if (catalogs.some((c) => c.url === popularCatalog.url)) {
      return;
    }
    useCustomOPDSStore.getState().addCatalog({ ...popularCatalog });
    persistMutation();
  };

  const handleRemoveCatalog = (id: string) => {
    useCustomOPDSStore.getState().removeCatalog(id);
    persistMutation();
    if (appService) {
      // Don't await — leftover state files are harmless and we don't want to
      // block UI removal if the filesystem call fails.
      void deleteSubscriptionState(appService, id);
    }
  };

  const handleToggleAutoDownload = (id: string) => {
    const target = catalogs.find((c) => c.id === id);
    if (!target) return;
    const wasEnabled = !!target.autoDownload;
    useCustomOPDSStore.getState().updateCatalog(id, { autoDownload: !wasEnabled });
    persistMutation();
    // When the user just enabled auto-download, sync now instead of waiting
    // for the next app launch / pull-to-refresh.
    if (!wasEnabled) {
      eventDispatcher.dispatch('check-opds-subscriptions');
    }
  };

  const handleOpenCatalog = (catalog: OPDSCatalog) => {
    const params = new URLSearchParams({ url: catalog.url });
    params.set('id', catalog.id);
    router.push(`/opds?${params.toString()}`);
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    setNewCatalog(EMPTY_NEW_CATALOG);
    setUrlError('');
    setHeaderError('');
    setProxyConsentError('');
    setShowPassword(false);
    setEditingCatalogId(null);
  };

  return (
    <div className='container max-w-2xl'>
      <div className='mb-8'>
        <h1 className='mb-2 text-base font-bold'>{_('OPDS Catalogs')}</h1>
        <p className='text-base-content/70 text-xs'>
          {_('Browse and download books from online catalogs')}
        </p>
      </div>

      {/* My Catalogs */}
      <section className='mb-12 text-base'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='font-semibold'>{_('My Catalogs')}</h2>
          <button onClick={() => setShowAddDialog(true)} className='btn btn-primary btn-sm'>
            <IoAdd className='h-4 w-4' />
            {_('Add Catalog')}
          </button>
        </div>

        {catalogs.length === 0 ? (
          <div className='border-base-300 rounded-lg border-2 border-dashed p-12 text-center'>
            <IoBook className='text-base-content/30 mx-auto mb-4 h-12 w-12' />
            <h3 className='mb-2 font-semibold'>{_('No catalogs yet')}</h3>
            <p className='text-base-content/70 mb-4 text-sm'>
              {_('Add your first OPDS catalog to start browsing books')}
            </p>
            <button onClick={() => setShowAddDialog(true)} className='btn btn-primary btn-sm'>
              {_('Add Your First Catalog')}
            </button>
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            {catalogs.map((catalog) => (
              <div
                key={catalog.id}
                className='card bg-base-100 border-base-300 h-full border shadow-sm transition-shadow hover:shadow-md'
              >
                <div className='card-body h-full justify-between p-4'>
                  <div className='flex items-center justify-between'>
                    <div className='min-w-0 flex-1'>
                      <div className='mb-1 flex items-center justify-between'>
                        <h3 className='card-title text-sm'>
                          {catalog.icon && <span>{catalog.icon}</span>}
                          <span className='line-clamp-1'>{catalog.name}</span>
                        </h3>
                        <div className='flex gap-1'>
                          <button
                            onClick={() => handleEditCatalog(catalog)}
                            className='btn btn-ghost btn-xs btn-square'
                            title={_('Edit')}
                          >
                            <IoPencil className='h-4 w-4' />
                          </button>
                          <button
                            onClick={() => handleRemoveCatalog(catalog.id)}
                            className='btn btn-ghost btn-xs btn-square'
                            title={_('Remove')}
                          >
                            <IoTrash className='h-4 w-4' />
                          </button>
                        </div>
                      </div>
                      {catalog.description && (
                        <p className='text-base-content/70 mb-2 line-clamp-1 h-6 text-sm sm:line-clamp-2 sm:h-10'>
                          {catalog.description}
                        </p>
                      )}
                      <p className='text-base-content/50 line-clamp-1 text-xs'>{catalog.url}</p>
                      {catalog.username && (
                        <p className='text-base-content/50 mt-1 text-xs'>
                          {_('Username')}: {catalog.username}
                        </p>
                      )}
                      {hasOPDSCustomHeaders(catalog.customHeaders) && (
                        <p className='text-base-content/50 mt-1 text-xs'>
                          {_('Custom Headers')}: {Object.keys(catalog.customHeaders || {}).length}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className='mt-2 flex items-center gap-2'>
                    <label
                      className={clsx(
                        'label gap-2 p-0',
                        catalog.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      )}
                    >
                      <input
                        type='checkbox'
                        className='toggle toggle-sm toggle-primary'
                        checked={!!catalog.autoDownload}
                        disabled={!!catalog.disabled}
                        onChange={() => handleToggleAutoDownload(catalog.id)}
                      />
                      <span className='label-text text-xs'>
                        <IoCloudDownloadOutline className='mr-1 inline h-3.5 w-3.5' />
                        {_('Auto-download')}
                      </span>
                    </label>
                  </div>
                  {(() => {
                    const subState = subscriptionStates[catalog.id];
                    if (!catalog.autoDownload || !subState) return null;
                    const lastCheckedAt = subState.lastCheckedAt;
                    const failedCount = subState.failedEntries.length;
                    if (lastCheckedAt === 0 && failedCount === 0) return null;
                    return (
                      <div className='text-base-content/60 mt-1 flex items-center gap-2 text-xs'>
                        {lastCheckedAt > 0 && (
                          <span>
                            {_('Last synced {{when}}', {
                              when: dayjs(lastCheckedAt).fromNow(),
                            })}
                          </span>
                        )}
                        {failedCount > 0 && (
                          <>
                            {lastCheckedAt > 0 && <span aria-hidden>·</span>}
                            <button
                              type='button'
                              onClick={() => setFailedDialogCatalogId(catalog.id)}
                              className='text-error hover:underline'
                            >
                              {_('{{count}} failed', { count: failedCount })}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <div className='card-actions mt-4 justify-end'>
                    <button
                      onClick={() => handleOpenCatalog(catalog)}
                      className='btn btn-sm btn-primary'
                    >
                      <IoOpenOutline className='h-4 w-4' />
                      {_('Browse')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Popular Catalogs */}
      <section className={clsx('text-base', popularCatalogs.length === 0 && 'hidden')}>
        <h2 className='mb-4 font-semibold'>{_('Popular Catalogs')}</h2>
        <div className='grid gap-4 sm:grid-cols-2'>
          {popularCatalogs
            .filter((catalog) => !catalog.disabled)
            .map((catalog) => {
              const isAdded = catalogs.some((c) => c.url === catalog.url);
              return (
                <div
                  key={catalog.id}
                  className='card bg-base-100 border-base-300 border shadow-sm transition-shadow hover:shadow-md'
                >
                  <div className='card-body p-4'>
                    <h3 className='card-title mb-1 text-sm'>
                      {catalog.icon && <span>{catalog.icon}</span>}
                      {catalog.name}
                    </h3>
                    {catalog.description && (
                      <p className='text-base-content/70 line-clamp-2 text-sm'>
                        {catalog.description}
                      </p>
                    )}
                    <div className='card-actions mt-4 justify-end gap-2'>
                      {!isAdded && (
                        <button
                          onClick={() => handleAddPopularCatalog(catalog)}
                          className='btn btn-sm'
                        >
                          <IoAdd className='h-4 w-4' />
                          {_('Add')}
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenCatalog(catalog)}
                        className='btn btn-sm btn-primary'
                      >
                        <IoOpenOutline className='h-4 w-4' />
                        {_('Browse')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Add/Edit Catalog Dialog */}
      {showAddDialog && (
        <ModalPortal>
          <dialog className='modal modal-open'>
            <div className='modal-box'>
              <h3 className='mb-4 text-lg font-bold'>
                {editingCatalogId ? _('Edit OPDS Catalog') : _('Add OPDS Catalog')}
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddCatalog();
                }}
                className='space-y-4'
              >
                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('Catalog Name')} *</span>
                  </div>
                  <input
                    type='text'
                    value={newCatalog.name}
                    onChange={(e) => setNewCatalog({ ...newCatalog, name: e.target.value })}
                    placeholder={_('My Calibre Library')}
                    className='input input-bordered placeholder:text-sm'
                    disabled={isValidating}
                    required
                  />
                </div>

                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('OPDS URL')} *</span>
                  </div>
                  <input
                    type='url'
                    value={newCatalog.url}
                    onChange={(e) => {
                      setNewCatalog({ ...newCatalog, url: e.target.value });
                      setUrlError('');
                    }}
                    placeholder='https://example.com/opds'
                    className='input input-bordered placeholder:text-sm'
                    disabled={isValidating}
                    required
                  />
                  {urlError && (
                    <div className='label'>
                      <span className='label-text-alt text-error'>{urlError}</span>
                    </div>
                  )}
                </div>

                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('Username (optional)')}</span>
                  </div>
                  <input
                    type='text'
                    value={newCatalog.username}
                    onChange={(e) => {
                      setNewCatalog({ ...newCatalog, username: e.target.value });
                      setProxyConsentError('');
                    }}
                    placeholder={_('Username')}
                    className='input input-bordered placeholder:text-sm'
                    disabled={isValidating}
                    autoComplete='username'
                  />
                </div>

                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('Password (optional)')}</span>
                  </div>
                  <div className='relative'>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newCatalog.password}
                      onChange={(e) => {
                        setNewCatalog({ ...newCatalog, password: e.target.value });
                        setProxyConsentError('');
                      }}
                      placeholder={_('Password')}
                      className='input input-bordered w-full pr-10 placeholder:text-sm'
                      disabled={isValidating}
                      autoComplete='current-password'
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='btn btn-ghost btn-sm btn-square absolute right-1 top-1/2 -translate-y-1/2'
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <IoEyeOff className='h-4 w-4' />
                      ) : (
                        <IoEye className='h-4 w-4' />
                      )}
                    </button>
                  </div>
                </div>

                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('Custom Headers (optional)')}</span>
                  </div>
                  <textarea
                    value={newCatalog.customHeadersInput}
                    onChange={(e) => {
                      setNewCatalog({ ...newCatalog, customHeadersInput: e.target.value });
                      setHeaderError('');
                      setProxyConsentError('');
                    }}
                    placeholder={formatOPDSCustomHeadersInput({
                      'CF-Access-Client-Id': 'your-client-id',
                      'CF-Access-Client-Secret': 'your-client-secret',
                    })}
                    className='textarea textarea-bordered font-mono text-sm placeholder:text-xs'
                    rows={4}
                    disabled={isValidating}
                    spellCheck={false}
                  />
                  <div className='label'>
                    <span className='label-text-alt text-base-content/60'>
                      {_('Add one header per line using "Header-Name: value".')}
                    </span>
                  </div>
                  {headerError && (
                    <div className='label pt-0'>
                      <span className='label-text-alt text-error'>{headerError}</span>
                    </div>
                  )}
                </div>

                {isWebCatalogProxyWarningRequired && (
                  <div className='form-control border-warning/30 bg-warning/10 rounded-lg border p-4'>
                    <label className='label cursor-pointer items-start justify-start gap-3 p-0'>
                      <input
                        type='checkbox'
                        className='checkbox checkbox-sm mt-0.5'
                        checked={newCatalog.proxyConsent}
                        onChange={(e) => {
                          setNewCatalog({ ...newCatalog, proxyConsent: e.target.checked });
                          setProxyConsentError('');
                        }}
                        disabled={isValidating}
                      />
                      <span className='label-text text-sm leading-6'>
                        {_(
                          'I understand this OPDS connection will be proxied through Readest servers on the web app. If I do not trust Readest with these credentials or headers, I should use the native app instead.',
                        )}
                      </span>
                    </label>
                    {proxyConsentError && (
                      <div className='label px-0 pb-0 pt-2'>
                        <span className='label-text-alt text-error'>{proxyConsentError}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className='form-control'>
                  <div className='label'>
                    <span className='label-text'>{_('Description (optional)')}</span>
                  </div>
                  <textarea
                    value={newCatalog.description}
                    onChange={(e) => setNewCatalog({ ...newCatalog, description: e.target.value })}
                    placeholder={_('A brief description of this catalog')}
                    className='textarea textarea-bordered text-sm placeholder:text-sm'
                    rows={2}
                    disabled={isValidating}
                  />
                </div>

                <div className='form-control'>
                  <label className='label cursor-pointer justify-start gap-3 p-0'>
                    <input
                      type='checkbox'
                      className='toggle toggle-sm toggle-primary'
                      checked={newCatalog.autoDownload}
                      onChange={(e) =>
                        setNewCatalog({ ...newCatalog, autoDownload: e.target.checked })
                      }
                      disabled={isValidating}
                    />
                    <div>
                      <span className='label-text'>{_('Auto-download new items')}</span>
                      <p className='text-base-content/60 text-xs'>
                        {_('Automatically download new publications when the app syncs')}
                      </p>
                    </div>
                  </label>
                </div>

                <div className='modal-action'>
                  <button
                    type='button'
                    onClick={handleCloseDialog}
                    className='btn'
                    disabled={isValidating}
                  >
                    {_('Cancel')}
                  </button>
                  <button type='submit' className='btn btn-primary' disabled={isValidating}>
                    {isValidating ? (
                      <>
                        <span className='loading loading-spinner loading-sm'></span>
                        {_('Validating...')}
                      </>
                    ) : editingCatalogId ? (
                      _('Save Changes')
                    ) : (
                      _('Add Catalog')
                    )}
                  </button>
                </div>
              </form>
            </div>
          </dialog>
        </ModalPortal>
      )}

      {failedDialogCatalogId && (
        <FailedDownloadsDialog
          catalogId={failedDialogCatalogId}
          catalogName={catalogs.find((c) => c.id === failedDialogCatalogId)?.name ?? ''}
          onClose={() => {
            setFailedDialogCatalogId(null);
            // The dialog mutates failedEntries / knownEntryIds — refresh the
            // status row so changes are visible without waiting for a sync.
            reloadSubscriptionStates();
          }}
        />
      )}
    </div>
  );
}
