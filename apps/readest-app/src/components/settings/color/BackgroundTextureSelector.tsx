import React from 'react';
import { MdRadioButtonChecked, MdClose, MdAdd } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Select from '@/components/Select';

interface Texture {
  id: string;
  url?: string;
  blobUrl?: string;
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
      <h2 className='mb-2 font-medium'>{_('Background Image')}</h2>
      <div className='mb-4 grid grid-cols-2 gap-4'>
        {allTextures.map((texture) => (
          <button
            key={texture.id}
            onClick={() => onTextureSelect(texture.id)}
            className={`bg-base-100 relative flex flex-col items-center justify-center rounded-lg border-2 p-4 shadow-md transition-all ${
              selectedTextureId === texture.id
                ? 'ring-2 ring-indigo-500 ring-offset-2'
                : 'border-base-300'
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
          </button>
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

      {/* Background Image Settings */}
      {selectedTextureId !== 'none' && (
        <div className='card border-base-200 bg-base-100 space-y-4 border p-4 shadow'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{_('Opacity')}</span>
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
              <span className='w-12 text-right text-sm'>
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
          </div>

          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{_('Size')}</span>
            <Select
              value={backgroundSize}
              onChange={(e) => onSizeChange(e.target.value)}
              options={[
                { value: 'auto', label: _('Auto') },
                { value: 'cover', label: _('Cover') },
                { value: 'contain', label: _('Contain') },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BackgroundTextureSelector;
