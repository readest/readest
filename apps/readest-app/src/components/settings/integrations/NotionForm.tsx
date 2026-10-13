import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { normalizeNotionObjectId, NotionClient } from '@/services/notion';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel } from '../primitives';
import { Toggle } from '@/components/primitives/toggle';

interface NotionFormProps {
  onBack: () => void;
}

const NotionForm: React.FC<NotionFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [accessToken, setAccessToken] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const isConfigured = !!settings.notion?.accessToken && !!settings.notion?.databaseId;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const normalizedId = normalizeNotionObjectId(databaseId);
      if (!normalizedId) {
        eventDispatcher.dispatch('toast', {
          message: _('Invalid Notion database ID or URL'),
          type: 'error',
        });
        return;
      }
      const client = new NotionClient({
        enabled: true,
        accessToken: accessToken.trim(),
        databaseId: normalizedId,
        lastSyncedAt: 0,
      });
      const { valid, isNetworkError } = await client.validateToken();
      if (valid) {
        const target = await client.resolveDataSourceId(normalizedId);
        if (!target.success) {
          eventDispatcher.dispatch('toast', {
            message: target.isNetworkError
              ? _('Unable to connect to Notion. Please check your network connection.')
              : target.code === 'multiple_data_sources'
                ? _(
                    'This Notion database has multiple data sources. Paste a data source ID instead.',
                  )
                : _(
                    'The Notion database is unavailable or has not been shared with this integration.',
                  ),
            type: 'error',
          });
          return;
        }
        const newSettings = {
          ...settings,
          notion: {
            enabled: true,
            accessToken: accessToken.trim(),
            databaseId: target.dataSourceId,
            lastSyncedAt: settings.notion?.lastSyncedAt ?? 0,
            includeChapterHeading: settings.notion?.includeChapterHeading ?? true,
          },
        };
        setSettings(newSettings);
        await saveSettings(envConfig, newSettings);
        eventDispatcher.dispatch('toast', { message: _('Connected to Notion'), type: 'success' });
      } else if (isNetworkError) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to connect to Notion. Please check your network connection.'),
          type: 'error',
        });
      } else {
        eventDispatcher.dispatch('toast', {
          message: _('Invalid Notion access token'),
          type: 'error',
        });
      }
    } finally {
      setIsConnecting(false);
      setAccessToken('');
    }
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      notion: {
        enabled: false,
        accessToken: '',
        databaseId: '',
        lastSyncedAt: 0,
        includeChapterHeading: settings.notion?.includeChapterHeading ?? true,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Notion'), type: 'info' });
  };

  const handleToggleEnabled = async () => {
    const newSettings = {
      ...settings,
      notion: { ...settings.notion, enabled: !settings.notion?.enabled },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleToggleChapterHeading = async () => {
    const newSettings = {
      ...settings,
      notion: {
        ...settings.notion,
        includeChapterHeading: !(settings.notion?.includeChapterHeading ?? true),
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const lastSyncedAt = settings.notion?.lastSyncedAt ?? 0;
  const lastSyncedLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : _('Never');

  const description: React.ReactNode = isConfigured ? (
    _('Connected to Notion. Last synced {{time}}.', { time: lastSyncedLabel })
  ) : (
    <>
      {_('Connect a Notion database to sync highlights and notes.')}{' '}
      {_('Create an integration and share a database with it at')}{' '}
      <a
        href='https://www.notion.so/my-integrations'
        target='_blank'
        rel='noopener noreferrer'
        className='link link-primary'
      >
        notion.so/my-integrations
      </a>
      .
    </>
  );

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Notion')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <div className='card eink-bordered border-base-200 bg-base-100 border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Sync Enabled')}</SettingLabel>
                <Toggle
                  checked={settings.notion?.enabled ?? false}
                  onChange={handleToggleEnabled}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Include Chapter Heading')}</SettingLabel>
                <Toggle
                  checked={settings.notion?.includeChapterHeading ?? true}
                  onChange={handleToggleChapterHeading}
                />
              </label>
            </div>
          </div>

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleDisconnect}
              className={clsx(
                'eink-bordered',
                'h-10 rounded-lg px-4 text-sm font-medium',
                'text-error hover:bg-error/10',
                'transition-colors duration-150',
                'focus-visible:ring-error/40 focus-visible:outline-hidden focus-visible:ring-2',
              )}
            >
              {_('Disconnect')}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-5'>
          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='notion-token' className='block'>
              {_('Access Token')}
            </SectionTitle>
            <input
              id='notion-token'
              type='password'
              placeholder={_('Paste your Notion integration token (secret_...)')}
              className='input eink-bordered settings-content h-11 w-full focus:outline-hidden'
              spellCheck='false'
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <SectionTitle as='label' htmlFor='notion-database-id' className='block'>
              {_('Database ID')}
            </SectionTitle>
            <input
              id='notion-database-id'
              type='text'
              placeholder={_('Paste the Notion database ID to sync into')}
              className='input eink-bordered settings-content h-11 w-full focus:outline-hidden'
              spellCheck='false'
              value={databaseId}
              onChange={(e) => setDatabaseId(e.target.value)}
            />
          </div>

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleConnect}
              disabled={isConnecting || !accessToken || !databaseId.trim()}
              className={clsx(
                'btn btn-contrast',
                'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                'focus-visible:ring-primary/40 focus-visible:outline-hidden focus-visible:ring-2',
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
        </div>
      )}
    </div>
  );
};

export default NotionForm;
