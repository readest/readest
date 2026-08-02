import clsx from 'clsx';
import React from 'react';
import { MdClose, MdPlayCircleOutline } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BoxedList, SectionTitle, SettingsRow, SettingsSelect } from '../primitives';
import { PiPlus } from 'react-icons/pi';
import type { BackgroundTextureScope } from '@/helpers/settings';

interface Texture {
  id: string;
  url?: string;
  blobUrl?: string;
  animated?: boolean;
  loaded?: boolean;
}

interface BackgroundTextureSelectorProps {
  predefinedTextures: Texture[];
  customTextures: Texture[];
  /** Which page's background is being edited (issue #5306). */
  scope: BackgroundTextureScope;
  onScopeChange: (scope: BackgroundTextureScope) => void;
  selectedTextureId: string;
  backgroundOpacity: number;
  backgroundSize: string;
  onTextureSelect: (id: string) => void;
  onOpacityChange: (opacity: number) => void;
  onSizeChange: (size: string) => void;
  onImportImage: () => void;
  onDeleteTexture: (id: string) => void;
}

const BackgroundTextureSelector: React.FC<BackgroundTextureSelectorProps> = ({
  predefinedTextures,
  customTextures,
  scope,
  onScopeChange,
  selectedTextureId,
  backgroundOpacity,
  backgroundSize,
  onTextureSelect,
  onOpacityChange,
  onSizeChange,
  onImportImage,
  onDeleteTexture,
}) => {
  const _ = useTranslation();
  const iconSize24 = useResponsiveSize(24);

  const allTextures = [...predefinedTextures, ...customTextures];

  return (
    <div>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <SectionTitle>{_('Background Image')}</SectionTitle>
        {/* Same segmented-control anatomy as ThemeModeSelector (44px targets,
            eink-bordered track + eink-inverted active thumb), with text labels:
            the visible Library|Reader pair is what tells users the two pages
            have separate backgrounds (issue #5306). */}
        <div
          role='radiogroup'
          aria-label={_('Background Image')}
          className='bg-base-200 eink-bordered inline-flex items-center rounded-full p-0.5'
        >
          {(
            [
              { scope: 'library', label: _('Library') },
              { scope: 'reader', label: _('Reader') },
            ] as const
          ).map(({ scope: segScope, label }) => {
            const active = scope === segScope;
            return (
              <button
                key={segScope}
                type='button'
                role='radio'
                aria-checked={active}
                onClick={() => onScopeChange(segScope)}
                className={clsx(
                  // em-based like SectionTitle, not rem-based text-sm — the
                  // settings-content wrapper scales 14/16px (DESIGN.md §5).
                  'flex h-9 items-center justify-center rounded-full px-3 text-[0.85em] font-medium transition-colors',
                  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                  active
                    ? 'bg-base-300 text-base-content eink-inverted shadow-sm'
                    : 'text-base-content/60 hover:text-base-content',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className='mb-4 grid grid-cols-3 gap-4'>
        {allTextures.map((texture) => (
          // The swatch is a div (not a <button>) so the inner Delete
          // <button> can nest legally — interactive elements can't be
          // descendants of <button> per HTML, and React 18+ flags it
          // as a hydration error. Keyboard a11y is preserved via
          // role="button" + tabIndex + Enter/Space onKeyDown.
          <div
            key={texture.id}
            role='button'
            tabIndex={0}
            onClick={() => onTextureSelect(texture.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTextureSelect(texture.id);
              }
            }}
            // Selected texture gets a 2px border in `base-content` (the
            // app's primary text color — white on dark mode, near-black on
            // light mode). Guaranteed contrast against any texture image.
            // Inactive cards keep `border-base-300` so the slot doesn't
            // shift on selection change.
            className={`bg-base-100 relative flex cursor-pointer flex-col items-start justify-between rounded-lg border-2 p-3 shadow-md transition-colors ${
              selectedTextureId === texture.id ? 'border-base-content' : 'border-base-300'
            }`}
            style={{
              backgroundImage: texture.loaded ? `url("${texture.blobUrl || texture.url}")` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'top',
              minHeight: '80px',
            }}
          >
            {texture.animated && (
              <MdPlayCircleOutline
                size={iconSize24}
                className='absolute bottom-2 left-2 text-white drop-shadow-md'
              />
            )}
            {!predefinedTextures.find((t) => t.id === texture.id) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTexture(texture.id);
                }}
                className='absolute left-2 top-2 rounded-full bg-red-500 p-1 text-white transition-colors hover:bg-red-600'
                title={_('Delete')}
              >
                <MdClose size={16} />
              </button>
            )}
          </div>
        ))}
        <button
          className='relative flex cursor-pointer flex-col gap-1 items-center justify-end rounded-lg border border-dashed p-3 shadow-md'
          onClick={onImportImage}
        >
          <PiPlus size={iconSize24} />
          <span className='max-w-full truncate font-semibold'>{_('Import Image')}</span>
        </button>
      </div>

      {/* Background Image Settings — boxed list once a texture is selected */}
      {selectedTextureId !== 'none' && (
        <BoxedList>
          <SettingsRow label={_('Opacity')}>
            <div className='flex items-center gap-2'>
              <input
                type='range'
                min='0'
                max='1'
                step='0.05'
                value={backgroundOpacity}
                onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                className='range range-sm w-32'
              />
              <span className='text-base-content/70 w-12 text-end text-sm'>
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
          </SettingsRow>
          <SettingsRow label={_('Size')}>
            <SettingsSelect
              value={backgroundSize}
              onChange={(e) => onSizeChange(e.target.value)}
              ariaLabel={_('Size')}
              options={[
                { value: 'auto', label: _('Auto') },
                { value: 'cover', label: _('Cover') },
                { value: 'contain', label: _('Contain') },
              ]}
            />
          </SettingsRow>
        </BoxedList>
      )}
    </div>
  );
};

export default BackgroundTextureSelector;
