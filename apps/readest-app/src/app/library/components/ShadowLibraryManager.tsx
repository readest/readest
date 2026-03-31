'use client';

import { useState, useEffect } from 'react';
import { IoAdd, IoTrash, IoOpenOutline, IoBook, IoRefresh, IoGlobe, IoKey, IoSettings } from 'react-icons/io5';
import { MdOutlineDns } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  ShadowLibraryProvider,
  ShadowLibraryProviderType,
  MirrorDomain,
  DEFAULT_SHADOW_LIBRARY_SETTINGS,
} from '@/types/shadow-library';
import { mirrorManager } from '@/services/shadow-library/mirrorManager';
import { initializeShadowLibrary, checkAllMirrors } from '@/services/shadow-library/shadowLibraryService';
import ModalPortal from '@/components/ModalPortal';
import { saveSysSettings } from '@/helpers/settings';

/**
 * Shadow Library Manager Component
 * 
 * Allows users to:
 * - Enable/disable shadow library providers
 * - Configure mirrors and domains
 * - Set authentication credentials
 * - Check mirror health
 */
export function ShadowLibraryManager() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { settings: appSettings, saveSettings } = useSettingsStore();
  
  const [providers, setProviders] = useState<ShadowLibraryProvider[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ShadowLibraryProvider | null>(null);
  const [isCheckingMirrors, setIsCheckingMirrors] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<Record<string, MirrorDomain[]>>({});

  // Initialize shadow library service
  useEffect(() => {
    initializeShadowLibrary();
    
    // Load providers from settings
    const shadowSettings = appSettings.shadowLibrary || DEFAULT_SHADOW_LIBRARY_SETTINGS;
    mirrorManager.initialize(shadowSettings);
    setProviders([...shadowSettings.providers]);
  }, []);

  const saveProviders = (updatedProviders: ShadowLibraryProvider[]) => {
    setProviders(updatedProviders);
    
    // Update shadow library settings
    const currentSettings = mirrorManager.getSettings();
    const updatedSettings = {
      ...currentSettings,
      providers: updatedProviders,
    };
    
    mirrorManager.updateSettings(updatedSettings);
    
    // Save to app settings
    saveSysSettings(envConfig, 'shadowLibrary', updatedSettings);
  };

  const handleToggleProvider = (providerId: string, enabled: boolean) => {
    const updated = providers.map(p => {
      if (p.id === providerId) {
        return { ...p, disabled: !enabled };
      }
      return p;
    });
    saveProviders(updated);
  };

  const handleUpdateCredentials = (
    providerId: string,
    credentials: { username?: string; password?: string; apiKey?: string }
  ) => {
    const updated = providers.map(p => {
      if (p.id === providerId) {
        return {
          ...p,
          ...credentials,
        };
      }
      return p;
    });
    saveProviders(updated);
  };

  const handleCheckMirrors = async () => {
    setIsCheckingMirrors(true);
    try {
      await checkAllMirrors();
      const settings = mirrorManager.getSettings();
      setMirrorStatus(
        settings.providers.reduce((acc, p) => {
          acc[p.id] = p.mirrors;
          return acc;
        }, {} as Record<string, MirrorDomain[]>)
      );
    } catch (error) {
      console.error('Failed to check mirrors:', error);
    } finally {
      setIsCheckingMirrors(false);
    }
  };

  const handleOpenProvider = (provider: ShadowLibraryProvider) => {
    router.push(`/shadow-library?id=${provider.id}`);
  };

  const getProviderTypeLabel = (type: ShadowLibraryProviderType): string => {
    switch (type) {
      case ShadowLibraryProviderType.SHADOW_LIBRARY:
        return 'Shadow Library';
      case ShadowLibraryProviderType.DOI_RESOLVER:
        return 'DOI Resolver';
      case ShadowLibraryProviderType.OPEN_ACCESS:
        return 'Open Access';
      case ShadowLibraryProviderType.AGGREGATOR:
        return 'Aggregator';
      default:
        return type;
    }
  };

  const getActiveMirrorCount = (provider: ShadowLibraryProvider): number => {
    return provider.mirrors.filter(m => m.isActive).length;
  };

  return (
    <div className='container max-w-4xl'>
      <div className='mb-8'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='mb-2 text-base font-bold'>{_('Shadow Libraries')}</h1>
            <p className='text-base-content/70 text-xs'>
              {_('Access academic papers and books from various sources')}
            </p>
          </div>
          <div className='flex gap-2'>
            <button
              onClick={handleCheckMirrors}
              disabled={isCheckingMirrors}
              className='btn btn-sm btn-ghost'
              title={_('Check mirror health')}
            >
              <IoRefresh className={`h-4 w-4 ${isCheckingMirrors ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowSettingsDialog(true)}
              className='btn btn-sm btn-ghost'
              title={_('Settings')}
            >
              <IoSettings className='h-4 w-4' />
            </button>
          </div>
        </div>
      </div>

      {/* Shadow Libraries */}
      <section className='mb-8 text-base'>
        <h2 className='mb-4 font-semibold'>{_('Shadow Libraries')}</h2>
        <div className='grid gap-4 sm:grid-cols-2'>
          {providers
            .filter(p => p.type === ShadowLibraryProviderType.SHADOW_LIBRARY)
            .map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onToggle={handleToggleProvider}
                onConfigure={() => setSelectedProvider(provider)}
                onOpen={() => handleOpenProvider(provider)}
                activeMirrorCount={getActiveMirrorCount(provider)}
              />
            ))}
        </div>
      </section>

      {/* DOI Resolvers */}
      <section className='mb-8 text-base'>
        <h2 className='mb-4 font-semibold'>{_('DOI Resolvers')}</h2>
        <div className='grid gap-4 sm:grid-cols-2'>
          {providers
            .filter(p => p.type === ShadowLibraryProviderType.DOI_RESOLVER)
            .map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onToggle={handleToggleProvider}
                onConfigure={() => setSelectedProvider(provider)}
                activeMirrorCount={getActiveMirrorCount(provider)}
              />
            ))}
        </div>
      </section>

      {/* Open Access */}
      <section className='text-base'>
        <h2 className='mb-4 font-semibold'>{_('Open Access Sources')}</h2>
        <div className='grid gap-4 sm:grid-cols-2'>
          {providers
            .filter(p => p.type === ShadowLibraryProviderType.OPEN_ACCESS)
            .map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onToggle={handleToggleProvider}
                onConfigure={() => setSelectedProvider(provider)}
                activeMirrorCount={getActiveMirrorCount(provider)}
              />
            ))}
        </div>
      </section>

      {/* Configure Provider Dialog */}
      {selectedProvider && (
        <ConfigureProviderDialog
          provider={selectedProvider}
          onClose={() => setSelectedProvider(null)}
          onUpdateCredentials={handleUpdateCredentials}
        />
      )}

      {/* Settings Dialog */}
      {showSettingsDialog && (
        <ShadowLibrarySettingsDialog
          onClose={() => setShowSettingsDialog(false)}
        />
      )}
    </div>
  );
}

/**
 * Provider Card Component
 */
function ProviderCard({
  provider,
  onToggle,
  onConfigure,
  onOpen,
  activeMirrorCount,
}: {
  provider: ShadowLibraryProvider;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: () => void;
  onOpen?: () => void;
  activeMirrorCount: number;
}) {
  const _ = useTranslation();

  return (
    <div className='card bg-base-100 border-base-300 border shadow-sm'>
      <div className='card-body p-4'>
        <div className='mb-2 flex items-start justify-between'>
          <div className='flex items-center gap-2'>
            <span className='text-xl'>{provider.icon}</span>
            <div>
              <h3 className='card-title text-sm'>{provider.name}</h3>
              <p className='text-base-content/50 text-xs'>
                {activeMirrorCount} / {provider.mirrors.length} mirrors active
              </p>
            </div>
          </div>
          <label className='swap swap-toggle'>
            <input
              type='checkbox'
              checked={!provider.disabled}
              onChange={e => onToggle(provider.id, e.target.checked)}
            />
          </label>
        </div>

        {provider.description && (
          <p className='text-base-content/70 mb-3 line-clamp-2 text-sm'>
            {provider.description}
          </p>
        )}

        {provider.capabilities.requiresAuth && (
          <div className='bg-warning/10 text-warning mb-3 rounded px-2 py-1 text-xs'>
            <IoKey className='mr-1 inline' />
            {_('Authentication required')}
          </div>
        )}

        <div className='card-actions justify-end gap-2'>
          <button onClick={onConfigure} className='btn btn-sm btn-ghost'>
            <IoSettings className='h-4 w-4' />
            {_('Configure')}
          </button>
          {onOpen && (
            <button onClick={onOpen} className='btn btn-sm btn-primary'>
              <IoOpenOutline className='h-4 w-4' />
              {_('Open')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Configure Provider Dialog
 */
function ConfigureProviderDialog({
  provider,
  onClose,
  onUpdateCredentials,
}: {
  provider: ShadowLibraryProvider;
  onClose: () => void;
  onUpdateCredentials: (
    id: string,
    credentials: { username?: string; password?: string; apiKey?: string }
  ) => void;
}) {
  const _ = useTranslation();
  const [username, setUsername] = useState(provider.username || '');
  const [password, setPassword] = useState(provider.password || '');
  const [apiKey, setApiKey] = useState(provider.apiKey || '');
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () => {
    onUpdateCredentials(provider.id, {
      username: username || undefined,
      password: password || undefined,
      apiKey: apiKey || undefined,
    });
    onClose();
  };

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box'>
          <h3 className='mb-4 text-lg font-bold'>
            {_('Configure')} - {provider.name}
          </h3>

          {/* Mirrors */}
          <div className='mb-6'>
            <h4 className='mb-2 text-sm font-semibold'>{_('Mirrors')}</h4>
            <div className='space-y-2'>
              {provider.mirrors.map((mirror, index) => (
                <div
                  key={mirror.url}
                  className={`flex items-center justify-between rounded border p-2 text-sm ${
                    mirror.isActive ? 'border-success bg-success/5' : 'border-error bg-error/5'
                  }`}
                >
                  <div className='flex items-center gap-2'>
                    <IoGlobe className='h-4 w-4' />
                    <span>{mirror.url}</span>
                    {mirror.name && (
                      <span className='text-base-content/50 text-xs'>({mirror.name})</span>
                    )}
                  </div>
                  <div className='flex items-center gap-2'>
                    {index === provider.activeMirrorIndex && (
                      <span className='badge badge-sm badge-primary'>{_('Active')}</span>
                    )}
                    {!mirror.isActive && (
                      <span className='text-error text-xs'>{_('Inactive')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Authentication */}
          {(provider.capabilities.requiresAuth || provider.apiKey) && (
            <div className='mb-6 space-y-4'>
              <h4 className='text-sm font-semibold'>{_('Authentication')}</h4>
              
              {provider.username !== undefined && (
                <div className='form-control'>
                  <label className='label'>
                    <span className='label-text'>{_('Username')}</span>
                  </label>
                  <input
                    type='text'
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className='input input-bordered input-sm'
                    autoComplete='username'
                  />
                </div>
              )}

              {provider.password !== undefined && (
                <div className='form-control'>
                  <label className='label'>
                    <span className='label-text'>{_('Password')}</span>
                  </label>
                  <div className='relative'>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className='input input-bordered input-sm w-full pr-10'
                      autoComplete='current-password'
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='btn btn-ghost btn-xs absolute right-1 top-1/2 -translate-y-1/2'
                    >
                      {showPassword ? '👁️' : '👁️‍🗨️'}
                    </button>
                  </div>
                </div>
              )}

              {provider.apiKey !== undefined && (
                <div className='form-control'>
                  <label className='label'>
                    <span className='label-text'>{_('API Key')}</span>
                  </label>
                  <input
                    type='password'
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    className='input input-bordered input-sm'
                    placeholder='your@email.com'
                  />
                  <label className='label'>
                    <span className='label-text-alt text-base-content/50'>
                      {_('Required for Unpaywall API access')}
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          <div className='modal-action'>
            <button onClick={onClose} className='btn'>
              {_('Cancel')}
            </button>
            <button onClick={handleSave} className='btn btn-primary'>
              {_('Save')}
            </button>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}

/**
 * Settings Dialog
 */
function ShadowLibrarySettingsDialog({ onClose }: { onClose: () => void }) {
  const _ = useTranslation();
  const settings = mirrorManager.getSettings();

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box'>
          <h3 className='mb-4 text-lg font-bold'>{_('Shadow Library Settings')}</h3>

          <div className='space-y-4'>
            <div className='form-control'>
              <label className='label cursor-pointer justify-start gap-4'>
                <IoRefresh className='h-5 w-5' />
                <div className='label-text'>
                  <div className='font-semibold'>{_('Auto-switch mirrors on failure')}</div>
                  <div className='text-base-content/50 text-xs'>
                    {_('Automatically try alternative mirrors when one fails')}
                  </div>
                </div>
                <input
                  type='checkbox'
                  className='toggle toggle-primary'
                  checked={settings.autoSwitchMirror}
                  readOnly
                />
              </label>
            </div>

            <div className='form-control'>
              <label className='label cursor-pointer justify-start gap-4'>
                <MdOutlineDns className='h-5 w-5' />
                <div className='label-text'>
                  <div className='font-semibold'>{_('Mirror health check interval')}</div>
                  <div className='text-base-content/50 text-xs'>
                    {_('How often to check if mirrors are working')}
                  </div>
                </div>
                <select
                  className='select select-bordered select-sm'
                  value={settings.mirrorCheckInterval}
                  readOnly
                >
                  <option value={60000}>{_('1 minute')}</option>
                  <option value={300000}>{_('5 minutes')}</option>
                  <option value={600000}>{_('10 minutes')}</option>
                  <option value={1800000}>{_('30 minutes')}</option>
                </select>
              </label>
            </div>
          </div>

          <div className='modal-action'>
            <button onClick={onClose} className='btn btn-primary'>
              {_('Close')}
            </button>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}
