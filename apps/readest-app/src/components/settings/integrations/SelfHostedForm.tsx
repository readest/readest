import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { SELF_HOSTED_STORAGE_KEY, SelfHostedLocalConfig } from '@/services/runtimeConfig';
import { SelfHostedConfig } from '@/types/settings';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, Tips } from '../primitives';

interface SelfHostedFormProps {
  onBack: () => void;
}

const SelfHostedForm: React.FC<SelfHostedFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const configured = settings.selfHosted;

  const [supabaseUrl, setSupabaseUrl] = useState(configured?.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(configured?.supabaseAnonKey ?? '');
  const [apiBaseUrl, setApiBaseUrl] = useState(configured?.apiBaseUrl ?? '');

  const isValid = supabaseUrl.trim() !== '' && supabaseAnonKey.trim() !== '';

  const persistConfig = async (cfg: SelfHostedConfig | undefined) => {
    const newSettings = { ...settings, selfHosted: cfg };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);

    if (cfg) {
      const local: SelfHostedLocalConfig = {
        supabaseUrl: cfg.supabaseUrl,
        supabaseAnonKey: cfg.supabaseAnonKey,
        apiBaseUrl: cfg.apiBaseUrl,
      };
      localStorage.setItem(SELF_HOSTED_STORAGE_KEY, JSON.stringify(local));
    } else {
      localStorage.removeItem(SELF_HOSTED_STORAGE_KEY);
    }
  };

  const handleSave = async () => {
    const cfg: SelfHostedConfig = {
      supabaseUrl: supabaseUrl.trim().replace(/\/$/, ''),
      supabaseAnonKey: supabaseAnonKey.trim(),
      apiBaseUrl: apiBaseUrl.trim().replace(/\/$/, ''),
    };
    await persistConfig(cfg);
    eventDispatcher.dispatch('toast', {
      message: _('Self-hosted instance saved. Restart the app to connect.'),
      type: 'info',
    });
  };

  const handleClear = async () => {
    await persistConfig(undefined);
    setSupabaseUrl('');
    setSupabaseAnonKey('');
    setApiBaseUrl('');
    eventDispatcher.dispatch('toast', {
      message: _('Self-hosted config cleared. Restart the app to reconnect to Readest Cloud.'),
      type: 'info',
    });
  };

  const description = configured
    ? _('Connected to {{url}}', { url: configured.supabaseUrl })
    : _('Point this app at your own Readest instance.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Self-hosted Instance')}
        description={description}
        onBack={onBack}
      />

      <form
        className='space-y-4'
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='sh-supabase-url' className='block'>
            {_('Supabase URL')}
          </SectionTitle>
          <input
            id='sh-supabase-url'
            type='url'
            placeholder='http://192.168.1.100:8000'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            value={supabaseUrl}
            onChange={(e) => setSupabaseUrl(e.target.value)}
          />
          <p className='text-base-content/55 text-xs'>
            {_('SUPABASE_PUBLIC_URL from your docker/.env (host:KONG_HTTP_PORT)')}
          </p>
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='sh-anon-key' className='block'>
            {_('Anon Key')}
          </SectionTitle>
          <input
            id='sh-anon-key'
            type='password'
            placeholder='eyJ...'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            value={supabaseAnonKey}
            onChange={(e) => setSupabaseAnonKey(e.target.value)}
            autoComplete='off'
          />
          <p className='text-base-content/55 text-xs'>{_('ANON_KEY from your docker/.env')}</p>
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='sh-api-base-url' className='block'>
            {_('Site URL')}
            <span className='text-base-content/50 ml-1 text-xs font-normal'>{_('(optional)')}</span>
          </SectionTitle>
          <input
            id='sh-api-base-url'
            type='url'
            placeholder='http://192.168.1.100:3000'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
          />
          <p className='text-base-content/55 text-xs'>
            {_(
              'SITE_URL from your docker/.env (host:3000). Leave blank to use Readest Cloud APIs.',
            )}
          </p>
        </div>

        <div className='flex justify-end gap-3 pt-1'>
          {configured && (
            <button
              type='button'
              onClick={() => void handleClear()}
              className={clsx(
                'eink-bordered',
                'h-10 rounded-lg px-4 text-sm font-medium',
                'text-error hover:bg-error/10',
                'transition-colors duration-150',
                'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
              )}
            >
              {_('Clear')}
            </button>
          )}
          <button
            type='submit'
            disabled={!isValid}
            className={clsx(
              'btn btn-primary',
              'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
              'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
              !isValid && 'opacity-60',
            )}
          >
            {_('Save')}
          </button>
        </div>
      </form>

      <div className='mt-5'>
        <Tips>
          <li>
            {_(
              'Values come from your docker/.env file. Run docker compose up to start your instance.',
            )}
          </li>
          <li>
            {_('The app must be restarted after saving for the new instance to take effect.')}
          </li>
          {configured && (
            <li>{_('Clear the config and restart to switch back to Readest Cloud.')}</li>
          )}
        </Tips>
      </div>
    </div>
  );
};

export default SelfHostedForm;
