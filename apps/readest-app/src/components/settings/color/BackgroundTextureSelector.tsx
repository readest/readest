import React from 'react';
import { MdRadioButtonChecked, MdClose, MdAdd, MdPlayCircleOutline } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BoxedList, SectionTitle, SettingsRow, SettingsSelect } from '../primitives';

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
      <SectionTitle className='mb-2'>{_('Background Image')}</SectionTitle>
      <div className='mb-4 grid grid-cols-2 gap-4'>
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
            className={`bg-base-100 relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 p-4 shadow-md transition-colors ${
              selectedTextureId === texture.id ? 'border-base-content' : 'border-base-300'
            }`}
            style={{
              backgroundImage: texture.loaded ? `url("${texture.blobUrl || texture.url}")` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'top',
              minHeight: '80px',
            }}
          >
            {selectedTextureId === texture.id && (
              <MdRadioButtonChecked
                size={iconSize24}
                className='absolute right-2 top-2 rounded-full bg-white text-indigo-500'
              />
            )}
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

        {/* Custom Image Upload */}
        <div
          className='border-base-300 relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 shadow-md transition-all'
          style={{ minHeight: '80px' }}
        >
          <button
            className='card-body flex cursor-pointer items-center justify-center p-2 text-center'
            onClick={onImportImage}
          >
            <div className='flex items-center gap-2'>
              <div className='flex items-center justify-center'>
                <MdAdd className='text-primary/85 group-hover:text-primary h-6 w-6' />
              </div>
              <div className='text-primary/85 group-hover:text-primary line-clamp-1 font-medium'>
                {_('Import Image')}
              </div>
            </div>
          </button>
        </div>
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
