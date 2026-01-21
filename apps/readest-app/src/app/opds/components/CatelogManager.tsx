'use client';

import { useState } from 'react';
import { IoAdd, IoTrash, IoOpenOutline, IoBook, IoEyeOff, IoEye } from 'react-icons/io5';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isWebAppPlatform } from '@/services/environment';
import { saveSysSettings } from '@/helpers/settings';
import { OPDSCatalog } from '@/types/opds';
import { isLanAddress } from '@/utils/network';
import { validateOPDSURL } from '../utils/opdsUtils';
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
): Promise<{ valid: boolean; error?: string }> {
  const result = await validateOPDSURL(url, username, password, isWebAppPlatform());
  return { valid: result.isValid, error: result.error };
}

export function CatalogManager() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const [catalogs, setCatalogs] = useState<OPDSCatalog[]>(() => settings.opdsCatalogs || []);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCatalog, setNewCatalog] = useState({
    name: '',
    url: '',
    description: '',
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  const saveCatalogs = (updatedCatalogs: OPDSCatalog[]) => {
    setCatalogs(updatedCatalogs);
    saveSysSettings(envConfig, 'opdsCatalogs', updatedCatalogs);
  };

  const handleAddCatalog = async () => {
    if (!newCatalog.name || !newCatalog.url) return;

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

    setIsValidating(true);
    setUrlError('');

    const validation = await validateOPDSCatalog(
      newCatalog.url,
      newCatalog.username || undefined,
      newCatalog.password || undefined,
    );

    if (!validation.valid) {
      setUrlError(validation.error || _('Invalid OPDS catalog. Please check the URL.'));
      setIsValidating(false);
      return;
    }

    const catalog: OPDSCatalog = {
      id: Date.now().toString(),
      name: newCatalog.name,
      url: newCatalog.url,
      description: newCatalog.description,
      username: newCatalog.username || undefined,
      password: newCatalog.password || undefined,
    };

    saveCatalogs([catalog, ...catalogs]);
    setNewCatalog({ name: '', url: '', description: '', username: '', password: '' });
    setUrlError('');
    setIsValidating(false);
    setShowAddDialog(false);
  };

  const handleAddPopularCatalog = (popularCatalog: OPDSCatalog) => {
    if (catalogs.some((c) => c.url === popularCatalog.url)) {
      return;
    }

    saveCatalogs([...catalogs, { ...popularCatalog }]);
  };

  const handleRemoveCatalog = (id: string) => {
    saveCatalogs(catalogs.filter((c) => c.id !== id));
  };

  const handleOpenCatalog = (catalog: OPDSCatalog) => {
    const params = new URLSearchParams({ url: catalog.url });
    if (catalog.username) params.set('id', catalog.id);
    router.push(`/opds?${params.toString()}`);
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    setNewCatalog({ name: '', url: '', description: '', username: '', password: '' });
    setUrlError('');
    setShowPassword(false);
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
          <div className='grid gap-4 sm:grid-cols-2'>
            {catalogs.map((catalog) => (
              <div
                key={catalog.id}
                className='card bg-base-100 border-base-300 h-full border shadow-sm transition-shadow hover:shadow-md'
              >
                <div className='card-body h-full justify-between p-4'>
                  <div className='flex items-center justify-between'>
                    <div className='min-w-0 flex-1'>
                      <div className='mb-1 flex items-center justify-between'>
                        <h3 className='card-title line-clamp-1 text-sm'>
                          {catalog.icon && <span className=''>{catalog.icon}</span>}
                          {catalog.name}
                        </h3>
                        <button
                          onClick={() => handleRemoveCatalog(catalog.id)}
                          className='btn btn-ghost btn-xs btn-square'
                          title='Remove'
                        >
                          <IoTrash className='h-4 w-4' />
                        </button>
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
                    </div>
                  </div>
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
      <section className='text-base'>
        <h2 className='mb-4 font-semibold'>{_('Popular Catalogs')}</h2>
        <div className='grid gap-4 sm:grid-cols-2'>
          {POPULAR_CATALOGS.filter((catalog) => !catalog.disabled).map((catalog) => {
            const isAdded = catalogs.some((c) => c.url === catalog.url);
            return (
              <div
                key={catalog.id}
                className='card bg-base-100 border-base-300 border shadow-sm transition-shadow hover:shadow-md'
              >
                <div className='card-body p-4'>
                  <h3 className='card-title mb-1 text-sm'>
                    {catalog.icon && <span className=''>{catalog.icon}</span>}
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

      {/* Add Catalog Dialog */}
      {showAddDialog && (
        <ModalPortal>
          <dialog className='modal modal-open'>
            <div className='modal-box'>
              <h3 className='mb-4 text-lg font-bold'>{_('Add OPDS Catalog')}</h3>
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
                    onChange={(e) => setNewCatalog({ ...newCatalog, url: e.target.value })}
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
                    onChange={(e) => setNewCatalog({ ...newCatalog, username: e.target.value })}
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
                      onChange={(e) => setNewCatalog({ ...newCatalog, password: e.target.value })}
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
    </div>
  );
}
