import clsx from 'clsx';
import React, { useState } from 'react';
import { MdAdd, MdDelete } from 'react-icons/md';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomFontStore } from '@/store/customFontStore';
import { FILE_SELECTION_PRESETS, useFileSelector } from '@/hooks/useFileSelector';
import { mountCustomFont } from '@/styles/fonts';
import { parseFontFamily } from '@/utils/font';
import { getFilename } from '@/utils/path';
import { saveViewSettings } from '../../utils/viewSettingsHelper';

interface CustomFontsProps {
  bookKey: string;
  onBack: () => void;
}

const CustomFonts: React.FC<CustomFontsProps> = ({ bookKey, onBack }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const {
    fonts: customFonts,
    addFont,
    loadFont,
    removeFont,
    getAvailableFonts,
    saveCustomFonts,
  } = useCustomFontStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  const { selectFiles } = useFileSelector(appService, _);

  const currentDefaultFont =
    viewSettings.defaultFont.toLowerCase() === 'serif' ? 'serif' : 'sans-serif';

  const currentFontFamily =
    currentDefaultFont === 'serif' ? viewSettings.serifFont : viewSettings.sansSerifFont;

  const handleImportFont = () => {
    selectFiles({ ...FILE_SELECTION_PRESETS.fonts, multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      if (!(await appService!.fs.exists('', 'Fonts'))) {
        await appService!.fs.createDir('', 'Fonts');
      }
      for (const selectedFile of result.files) {
        let fontPath: string;
        let fontFile: File;
        if (selectedFile.path) {
          const filePath = selectedFile.path;
          fontPath = getFilename(filePath);
          await appService!.fs.copyFile(filePath, fontPath, 'Fonts');
          fontFile = await appService!.fs.openFile(fontPath, 'Fonts');
        } else if (selectedFile.file) {
          const file = selectedFile.file;
          fontPath = getFilename(file.name);
          await appService!.fs.writeFile(fontPath, 'Fonts', file);
          fontFile = file;
        } else {
          continue;
        }
        const fontFamily = parseFontFamily(await fontFile.arrayBuffer(), fontPath);
        const customFont = addFont(fontPath, {
          name: fontFamily,
        });
        if (customFont && !customFont.error) {
          const loadedFont = await loadFont(envConfig, customFont.id);
          mountCustomFont(document, loadedFont);
        }
      }
      saveCustomFonts(envConfig);
    });
  };

  const handleDeleteFont = (fontId: string) => {
    const font = customFonts.find((f) => f.id === fontId);
    if (font) {
      if (removeFont(fontId)) {
        appService!.fs.removeFile(font.path, 'Fonts');
        saveCustomFonts(envConfig);
        if (getAvailableFonts().length === 0) {
          setIsDeleteMode(false);
        }
      }
    }
  };

  const handleSelectFont = (fontId: string) => {
    const font = customFonts.find((f) => f.id === fontId);
    if (font) {
      if (currentDefaultFont === 'serif') {
        saveViewSettings(envConfig, bookKey, 'serifFont', font.name);
      } else {
        saveViewSettings(envConfig, bookKey, 'sansSerifFont', font.name);
      }
    }
  };

  const toggleDeleteMode = () => {
    setIsDeleteMode(!isDeleteMode);
  };

  const availableFonts = customFonts
    .filter((font) => !font.deletedAt)
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));

  return (
    <div className='w-full'>
      <div className='mb-6 flex h-8 items-center justify-between'>
        <div className='breadcrumbs py-1'>
          <ul>
            <li>
              <a className='font-semibold' onClick={onBack}>
                {_('Font')}
              </a>
            </li>
            <li className='font-medium'>{_('Custom Fonts')}</li>
          </ul>
        </div>
        {availableFonts.length > 0 && (
          <button
            onClick={toggleDeleteMode}
            className={`btn btn-ghost btn-sm text-base-content gap-2`}
            title={isDeleteMode ? _('Cancel Delete') : _('Delete Font')}
          >
            {isDeleteMode ? (
              <>{_('Cancel')}</>
            ) : (
              <>
                <MdDelete className='h-4 w-4' />
                {_('Delete')}
              </>
            )}
          </button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-4'>
        <div className='card border-primary/50 hover:border-primary/75 group h-12 border-2 transition-colors'>
          <div
            className='card-body flex cursor-pointer items-center justify-center p-2 text-center'
            onClick={handleImportFont}
          >
            <div className='flex items-center gap-2'>
              <div className='flex items-center justify-center'>
                <MdAdd className='text-primary/85 group-hover:text-primary h-6 w-6' />
              </div>
              <div className='text-primary/85 group-hover:text-primary font-medium'>
                {_('Import Font')}
              </div>
            </div>
          </div>
        </div>

        {availableFonts.map((font) => (
          <div
            key={font.id}
            className={clsx(
              'card h-12 border shadow-sm',
              currentFontFamily === font.name
                ? 'border-primary/50 bg-primary/50'
                : 'border-base-200 bg-base-200 cursor-pointer',
            )}
            onClick={() => handleSelectFont(font.id)}
          >
            <div className='card-body flex items-center justify-center p-2'>
              <div
                style={{
                  fontFamily: font.loaded ? `"${font.name}", sans-serif` : 'sans-serif',
                  fontWeight: 400,
                }}
                className='text-base-content line-clamp-1 max-w-[90%]'
              >
                {font.name}
              </div>
              {isDeleteMode && (
                <button
                  onClick={() => handleDeleteFont(font.id)}
                  className='btn btn-ghost btn-xs absolute right-[-10px] top-[-10px] h-6 min-h-0 w-6 p-0 hover:bg-transparent'
                  title={_('Delete Font')}
                >
                  <IoMdCloseCircleOutline className='text-base-content/75 h-6 w-6' />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className='bg-base-200/30 my-8 rounded-lg p-4'>
        <div className='text-base-content/70'>
          <div className='mb-1 text-xs font-medium'>{_('Tips')}:</div>
          <ul className='list-inside list-disc space-y-1 text-sm sm:text-xs'>
            <li>{_('Supported font formats: .ttf, .odf, .woff, .woff2')}</li>
            <li>{_('Custom fonts can be selected from the Font Face menu')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CustomFonts;
