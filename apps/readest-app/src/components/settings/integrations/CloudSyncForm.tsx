import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SettingsRow } from '../primitives';
import WebDAVForm from './WebDAVForm';
import GoogleDriveForm from './GoogleDriveForm';

interface CloudSyncFormProps {
  onBack: () => void;
}

/**
 * Unified "Cloud Sync" sub-page: pick ONE third-party cloud provider (WebDAV or
 * Google Drive — mutually exclusive), then configure the shared sync options
 * below for whichever is active. The provider picker is the
 * mutually-exclusive-radio pattern (cf. AIPanel); the panel under it is the
 * selected provider's connect/options surface, which owns activation and turns
 * the other provider off on connect.
 *
 * Google Drive is offered only on desktop (its OAuth runner is desktop-only for
 * now); on mobile the page is WebDAV only and the picker is hidden.
 */
const CloudSyncForm: React.FC<CloudSyncFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  const providers: FileSyncBackendKind[] = appService?.isDesktopApp
    ? ['webdav', 'gdrive']
    : ['webdav'];

  const activeKind: FileSyncBackendKind | null = settings.webdav?.enabled
    ? 'webdav'
    : settings.googleDrive?.enabled
      ? 'gdrive'
      : null;

  const [selectedKind, setSelectedKind] = useState<FileSyncBackendKind>(
    activeKind ?? providers[0]!,
  );

  const labelFor = (kind: FileSyncBackendKind): string =>
    kind === 'webdav' ? _('WebDAV') : _('Google Drive');

  const statusFor = (kind: FileSyncBackendKind): string => {
    if (kind === 'webdav') {
      if (settings.webdav?.enabled) return _('Active');
      return settings.webdav?.serverUrl && settings.webdav?.username
        ? _('Configured')
        : _('Not connected');
    }
    if (settings.googleDrive?.enabled) return settings.googleDrive.accountLabel || _('Active');
    return settings.googleDrive?.accountLabel ? _('Configured') : _('Not connected');
  };

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Cloud Sync')}
        description={_(
          'Sync your library to one third-party cloud. Only one provider is active at a time.',
        )}
        onBack={onBack}
      />

      {providers.length > 1 && (
        <BoxedList title={_('Provider')} className='mb-5'>
          {providers.map((kind) => (
            <SettingsRow key={kind} label={labelFor(kind)} description={statusFor(kind)} asLabel>
              <input
                type='radio'
                name='cloud-sync-provider'
                className='radio'
                checked={selectedKind === kind}
                onChange={() => setSelectedKind(kind)}
              />
            </SettingsRow>
          ))}
        </BoxedList>
      )}

      {selectedKind === 'webdav' ? <WebDAVForm /> : <GoogleDriveForm />}
    </div>
  );
};

export default CloudSyncForm;
