import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdChevronRight } from 'react-icons/md';
import {
  RiBookOpenLine,
  RiRssLine,
  RiBookReadLine,
  RiBook3Line,
  RiDiscordLine,
  RiSendPlaneLine,
  RiCloudLine,
  RiGoogleLine,
} from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { CatalogManager } from '@/app/opds/components/CatalogManager';
import { saveSysSettings } from '@/helpers/settings';
import { isCloudSyncAllowed } from '@/utils/access';
import { isWebAppPlatform } from '@/services/environment';
import { getGoogleWebClientId } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import KOSyncForm from './integrations/KOSyncForm';
import ReadwiseForm from './integrations/ReadwiseForm';
import HardcoverForm from './integrations/HardcoverForm';
import SendToReadestForm from './integrations/SendToReadestForm';
import WebDAVForm from './integrations/WebDAVForm';
import GoogleDriveForm from './integrations/GoogleDriveForm';
import { persistActiveCloudProvider } from './integrations/cloudSync';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import SubPageHeader from './SubPageHeader';
import { SectionTitle, SettingLabel } from './primitives';

type SubPage = 'kosync' | 'webdav' | 'gdrive' | 'readwise' | 'hardcover' | 'opds' | 'send' | null;

/**
 * Integrations panel — single point of discovery for external service config:
 * KOReader Sync, Readwise, Hardcover, and OPDS Catalogs.
 *
 * Pattern: boxed list of NavigationRows. Each row pushes the panel into an
 * inline sub-page (with breadcrumb back-navigation matching the Dictionaries
 * pattern) — no nested modals.
 *
 * TODO(design-system): Once we extract BoxedList / NavigationRow primitives,
 * this panel and CustomDictionaries should both consume them instead of
 * inlining the chassis.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings, requestedSubPage, setRequestedSubPage } = useSettingsStore();
  const opdsCatalogs = useCustomOPDSStore((s) => s.catalogs);
  const opdsCount = opdsCatalogs.filter((c) => !c.deletedAt).length;
  // Surface a library-wide WebDAV sync that's mid-flight in the row's
  // status line. Keeps the user from feeling like the run was lost
  // when they back out of the WebDAV sub-page or close the dialog.
  const isWebDAVSyncing = useFileSyncStore((s) => s.byKind.webdav?.isSyncing ?? false);
  const isGDriveSyncing = useFileSyncStore((s) => s.byKind.gdrive?.isSyncing ?? false);
  // Third-party cloud sync will be a premium feature (any paid plan), but it is
  // temporarily UNGATED while the feature stabilises — `isCloudSyncAllowed`
  // returns true for every plan until `CLOUD_SYNC_REQUIRES_PREMIUM` is flipped
  // back on. The `?? 'free'` keeps the (re-gated) loading state non-premium.
  const { userProfilePlan } = useQuotaStats();
  const isCloudSyncPremium = isCloudSyncAllowed(userProfilePlan ?? 'free');

  const [subPage, setSubPage] = useState<SubPage>(null);

  // Android Back / Esc: when any integrations sub-page (KOSync, WebDAV,
  // Readwise, Hardcover, OPDS, Send-to-Readest) is open, intercept and
  // step back to the integrations list instead of letting <Dialog>'s
  // listener close the whole Settings dialog. The hook registers its
  // sync `native-key-down` listener *after* <Dialog>'s, and
  // `dispatchSync` walks listeners LIFO — so this one claims Back first
  // when enabled and `return true` consumes the event. When subPage is
  // null the hook is disabled and Back falls through to close the dialog
  // as before.
  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  const toggleDiscordPresence = () => {
    const discordRichPresenceEnabled = !settings.discordRichPresenceEnabled;
    saveSysSettings(envConfig, 'discordRichPresenceEnabled', discordRichPresenceEnabled);
    if (discordRichPresenceEnabled && !user) {
      navigateToLogin(router);
    }
  };

  // Deep-link consumption: when a caller (e.g. OPDS browser close handler)
  // sets `requestedSubPage` in the store before opening the dialog, drill
  // straight into that sub-page on mount and clear the request so it doesn't
  // stick to the next open. Recognised values match the SubPage union.
  useEffect(() => {
    if (!requestedSubPage) return;
    const isCloudRequest =
      requestedSubPage === 'webdav' ||
      requestedSubPage === 'gdrive' ||
      requestedSubPage === 'cloudsync';
    // Cloud-sync sub-pages are premium-gated. If the plan is still loading, wait
    // (don't consume the request); once known, only honor it for paid plans.
    if (isCloudRequest && !isCloudSyncPremium) {
      if (userProfilePlan === undefined) return;
      setRequestedSubPage(null);
      return;
    }
    if (
      requestedSubPage === 'kosync' ||
      requestedSubPage === 'webdav' ||
      requestedSubPage === 'gdrive' ||
      requestedSubPage === 'readwise' ||
      requestedSubPage === 'hardcover' ||
      requestedSubPage === 'opds' ||
      requestedSubPage === 'send'
    ) {
      setSubPage(requestedSubPage);
    } else if (requestedSubPage === 'cloudsync') {
      // Back-compat with the brief unified "Cloud Sync" page.
      setSubPage('gdrive');
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage, isCloudSyncPremium, userProfilePlan]);

  // Sub-page wrapper matches the list-view's `my-4 w-full` so the
  // SubPageHeader's "Integrations" label lands at the exact same Y position
  // as the list-view's h2 — clicking a row reads as a navigation morph
  // rather than a layout shift.
  if (subPage === 'kosync')
    return (
      <div className='my-4 w-full'>
        <KOSyncForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'webdav')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('WebDAV')}
          description={_(
            'Sync your library, reading progress, and highlights with a WebDAV server.',
          )}
          onBack={() => setSubPage(null)}
        />
        <WebDAVForm />
      </div>
    );
  if (subPage === 'gdrive')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('Google Drive')}
          description={_(
            'Sync your library, reading progress, and highlights with your Google Drive.',
          )}
          onBack={() => setSubPage(null)}
        />
        <GoogleDriveForm />
      </div>
    );
  if (subPage === 'readwise')
    return (
      <div className='my-4 w-full'>
        <ReadwiseForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'hardcover')
    return (
      <div className='my-4 w-full'>
        <HardcoverForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'opds')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('OPDS Catalogs')}
          description={_('Browse and download books from online catalogs.')}
          onBack={() => setSubPage(null)}
        />
        <CatalogManager inSubPage />
      </div>
    );
  if (subPage === 'send')
    return (
      <div className='my-4 w-full'>
        <SendToReadestForm onBack={() => setSubPage(null)} />
      </div>
    );

  const koSyncStatus = settings.kosync?.enabled
    ? settings.kosync.username
      ? _('Connected as {{user}}', { user: settings.kosync.username })
      : _('Connected')
    : _('Not connected');

  const readwiseStatus = settings.readwise?.enabled ? _('Connected') : _('Not connected');
  const hardcoverStatus = settings.hardcover?.enabled ? _('Connected') : _('Not connected');

  // Third-party cloud providers are mutually exclusive: at most one is the
  // active sync target. A "configured" provider (WebDAV creds / a Drive token)
  // can be switched on inline; an unconfigured one must be opened to connect.
  const activeCloudKind: FileSyncBackendKind | null = settings.webdav?.enabled
    ? 'webdav'
    : settings.googleDrive?.enabled
      ? 'gdrive'
      : null;
  const webdavConfigured = !!(settings.webdav?.serverUrl && settings.webdav?.username);
  const gdriveConfigured = !!settings.googleDrive?.accountLabel;
  const webdavStatus = settings.webdav?.enabled
    ? isWebDAVSyncing
      ? _('Syncing…')
      : _('Active')
    : webdavConfigured
      ? _('Configured')
      : _('Not connected');
  const gdriveStatus = settings.googleDrive?.enabled
    ? isGDriveSyncing
      ? _('Syncing…')
      : _('Active')
    : gdriveConfigured
      ? _('Configured')
      : _('Not connected');

  const activateCloudProvider = async (kind: FileSyncBackendKind) => {
    await persistActiveCloudProvider(envConfig, kind);
  };

  const opdsStatus =
    opdsCount > 0 ? _('{{count}} catalog', { count: opdsCount }) : _('No catalogs');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Connect Readest to external services for sync, highlights, and catalogs.')}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.sync'>
        <SectionTitle className='mb-2'>{_('Reading Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiBookOpenLine}
              title={_('KOReader Sync')}
              status={koSyncStatus}
              onClick={() => setSubPage('kosync')}
            />
            <IntegrationRow
              icon={RiBookReadLine}
              title={_('Readwise')}
              status={readwiseStatus}
              onClick={() => setSubPage('readwise')}
            />
            <IntegrationRow
              icon={RiBook3Line}
              title={_('Hardcover')}
              status={hardcoverStatus}
              onClick={() => setSubPage('hardcover')}
            />
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.cloudSync'>
        <SectionTitle className='mb-2'>{_('Third-party Cloud Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            {isCloudSyncPremium ? (
              <>
                <CloudProviderRow
                  icon={RiCloudLine}
                  title={_('WebDAV')}
                  status={webdavStatus}
                  isActive={activeCloudKind === 'webdav'}
                  canActivate={webdavConfigured}
                  onActivate={() => activateCloudProvider('webdav')}
                  onOpen={() => setSubPage('webdav')}
                  activateLabel={_('Use WebDAV')}
                />
                {(appService?.isDesktopApp ||
                  appService?.isAndroidApp ||
                  appService?.isIOSApp ||
                  // Web: only when a Web-type GIS client id is configured for this build.
                  (isWebAppPlatform() && !!getGoogleWebClientId())) && (
                  <CloudProviderRow
                    icon={RiGoogleLine}
                    title={_('Google Drive')}
                    status={gdriveStatus}
                    isActive={activeCloudKind === 'gdrive'}
                    canActivate={gdriveConfigured}
                    onActivate={() => activateCloudProvider('gdrive')}
                    onOpen={() => setSubPage('gdrive')}
                    activateLabel={_('Use Google Drive')}
                  />
                )}
              </>
            ) : (
              // Premium-gated: free users get an upgrade prompt instead of the
              // provider rows. Tapping opens the plans page.
              <IntegrationRow
                icon={RiCloudLine}
                title={_('Cloud Sync')}
                status={_('Available on Plus, Pro, or Lifetime')}
                onClick={() => navigateToProfile(router)}
              />
            )}
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.catalogs'>
        <SectionTitle className='mb-2'>{_('Content Sources')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiRssLine}
              title={_('OPDS Catalogs')}
              status={opdsStatus}
              onClick={() => setSubPage('opds')}
            />
            <IntegrationRow
              icon={RiSendPlaneLine}
              title={_('Send to Readest')}
              status={_('Email books to your library')}
              onClick={() => setSubPage('send')}
            />
          </div>
        </div>
      </div>

      {appService?.isDesktopApp && (
        <div className='w-full' data-setting-id='settings.integrations.discord'>
          <SectionTitle className='mb-2'>{_('Discord')}</SectionTitle>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <IntegrationToggleRow
                icon={RiDiscordLine}
                title={_('Show on Discord')}
                description={_("Display what I'm reading on Discord")}
                checked={settings.discordRichPresenceEnabled}
                onChange={toggleDiscordPresence}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface IntegrationRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  onClick: () => void;
}

const IntegrationRow: React.FC<IntegrationRowProps> = ({ icon: Icon, title, status, onClick }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-150',
        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
          'transition-colors duration-150',
          'group-hover:bg-base-300/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
      </div>
      <MdChevronRight className='text-base-content/50 h-5 w-5 flex-shrink-0' />
    </button>
  );
};

interface CloudProviderRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  /** This provider is the active sync target. */
  isActive: boolean;
  /** Configured (credentials / token present) — can be switched on inline. */
  canActivate: boolean;
  onActivate: () => void;
  onOpen: () => void;
  /** Accessible label for the activate radio (e.g. "Use WebDAV"). */
  activateLabel: string;
}

/**
 * A third-party cloud-sync provider row. Two controls: a trailing radio that
 * makes this provider the (single) active one inline — enabled only when it's
 * already configured — and the row body / chevron that opens its config
 * sub-page (connect, sync options, disconnect).
 */
const CloudProviderRow: React.FC<CloudProviderRowProps> = ({
  icon: Icon,
  title,
  status,
  isActive,
  canActivate,
  onActivate,
  onOpen,
  activateLabel,
}) => {
  return (
    <div className='group flex w-full items-center gap-3 px-4 py-3'>
      <button
        type='button'
        onClick={onOpen}
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-3 text-left',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
        )}
      >
        <span
          className={clsx(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
            'bg-base-200 text-base-content/70',
            'transition-colors duration-150',
            'group-hover:bg-base-300/70',
          )}
        >
          <Icon className='h-5 w-5' />
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <SettingLabel>{title}</SettingLabel>
          <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
        </div>
      </button>
      <input
        type='radio'
        name='cloud-sync-active'
        className='radio radio-sm flex-shrink-0'
        checked={isActive}
        disabled={!canActivate}
        onChange={onActivate}
        aria-label={activateLabel}
        title={activateLabel}
      />
      <button
        type='button'
        onClick={onOpen}
        aria-label={title}
        className={clsx(
          'text-base-content/50 hover:text-base-content/80 flex-shrink-0 rounded',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
        )}
      >
        <MdChevronRight className='h-5 w-5' />
      </button>
    </div>
  );
};

interface IntegrationToggleRowProps {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

/**
 * Sibling of IntegrationRow for settings that are a simple on/off toggle
 * (no sub-page). Keeps the same circular-badge chassis so toggle and
 * navigation rows read as one consistent list.
 */
const IntegrationToggleRow: React.FC<IntegrationToggleRowProps> = ({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}) => {
  return (
    <label className='flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left'>
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{description}</span>
      </div>
      <input
        type='checkbox'
        className='toggle flex-shrink-0'
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
};

export default IntegrationsPanel;
