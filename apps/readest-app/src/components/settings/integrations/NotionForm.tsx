import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import {
  DEFAULT_NOTION_NOTE_TEMPLATE,
  normalizeNotionObjectId,
  NotionClient,
} from '@/services/notion';
import type { NotionSettings } from '@/types/settings';
import { validateNoteTemplate } from '@/utils/note';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SectionTitle, SettingsSwitchRow, Tips } from '../primitives';

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
  const [template, setTemplate] = useState(
    settings.notion?.customTemplate || DEFAULT_NOTION_NOTE_TEMPLATE,
  );
  const [templateError, setTemplateError] = useState('');

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

  const saveNotion = async (patch: Partial<NotionSettings>) => {
    const newSettings = { ...settings, notion: { ...settings.notion, ...patch } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  // An editor value that doesn't compile is never saved; the last valid
  // template stays in the settings.
  const handleToggleTemplate = () =>
    saveNotion({
      useCustomTemplate: !settings.notion?.useCustomTemplate,
      ...(validateNoteTemplate(template).isValid ? { customTemplate: template } : {}),
    });

  const handleSaveTemplate = async (value: string) => {
    const { isValid, error } = validateNoteTemplate(value);
    setTemplateError(isValid ? '' : (error ?? ''));
    if (isValid) await saveNotion({ customTemplate: value });
  };

  const handleResetTemplate = () => {
    setTemplate(DEFAULT_NOTION_NOTE_TEMPLATE);
    handleSaveTemplate(DEFAULT_NOTION_NOTE_TEMPLATE);
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
          <BoxedList>
            <SettingsSwitchRow
              label={_('Sync Enabled')}
              checked={settings.notion?.enabled ?? false}
              onChange={handleToggleEnabled}
            />
            <SettingsSwitchRow
              label={_('Include Chapter Heading')}
              checked={settings.notion?.includeChapterHeading ?? true}
              onChange={handleToggleChapterHeading}
              disabled={settings.notion?.useCustomTemplate}
            />
            <SettingsSwitchRow
              label={_('Use Custom Template')}
              checked={settings.notion?.useCustomTemplate ?? false}
              onChange={handleToggleTemplate}
            />
          </BoxedList>

          {settings.notion?.useCustomTemplate && (
            <div className='space-y-1.5'>
              <div className='flex items-center justify-between'>
                <SectionTitle as='label' htmlFor='notion-template' className='block'>
                  {_('Note Template')}
                </SectionTitle>
                <button
                  type='button'
                  onClick={handleResetTemplate}
                  className='min-h-11 min-w-11 cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
                >
                  {_('Reset Template')}
                </button>
              </div>
              <textarea
                id='notion-template'
                dir='ltr'
                rows={10}
                spellCheck='false'
                className='textarea eink-bordered settings-content w-full font-mono text-xs focus:outline-hidden'
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                onBlur={() => handleSaveTemplate(template)}
              />
              {templateError && <p className='text-error text-xs'>{templateError}</p>}
              <Tips>
                <li>
                  {_(
                    'Each highlight is rendered as Markdown with Nunjucks, then sent to Notion as blocks',
                  )}
                </li>
                <li>{_('Quotes take the highlight color, and > [!NOTE] becomes a callout')}</li>
                <li>
                  {_('Variables: {{variables}}', {
                    variables:
                      'title, chapter.title, annotation.text, annotation.note, annotation.color, annotation.style, annotation.page, annotation.timestamp, annotation.link, annotation.appLink',
                  })}
                </li>
              </Tips>
            </div>
          )}

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
