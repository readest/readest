import React, { useState, useEffect } from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode, MdClose, MdAdd } from 'react-icons/md';
import { MdRadioButtonUnchecked, MdRadioButtonChecked } from 'react-icons/md';
import { CgColorPicker } from 'react-icons/cg';
import { TbSunMoon } from 'react-icons/tb';
import { PiPlus } from 'react-icons/pi';
import {
  applyCustomTheme,
  CustomTheme,
  generateDarkPalette,
  generateLightPalette,
  Theme,
  themes,
} from '@/styles/themes';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { saveViewSettings } from '@/helpers/viewSettings';
import { CODE_LANGUAGES, CodeLanguage, manageSyntaxHighlighting } from '@/utils/highlightjs';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { useFileSelector } from '@/hooks/useFileSelector';
import { PREDEFINED_TEXTURES } from '@/styles/textures';
import { HighlightColor } from '@/types/book';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import Select from '@/components/Select';
import ThemeEditor from './ThemeEditor';
import ColorInput from './ColorInput';

const ColorPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor, saveCustomTheme } =
    useThemeStore();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings.invertImgColorInDark,
  );

  const iconSize16 = useResponsiveSize(16);
  const iconSize24 = useResponsiveSize(24);
  const [editTheme, setEditTheme] = useState<CustomTheme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [showCustomThemeEditor, setShowCustomThemeEditor] = useState(false);
  const [overrideColor, setOverrideColor] = useState(viewSettings.overrideColor);
  const [codeHighlighting, setcodeHighlighting] = useState(viewSettings.codeHighlighting);
  const [codeLanguage, setCodeLanguage] = useState(viewSettings.codeLanguage);

  const [selectedTextureId, setSelectedTextureId] = useState(viewSettings.backgroundTextureId);
  const [backgroundOpacity, setBackgroundOpacity] = useState(viewSettings.backgroundOpacity);
  const [backgroundSize, setBackgroundSize] = useState(viewSettings.backgroundSize);

  const [customHighlightColors, setCustomHighlightColors] = useState(
    settings.globalReadSettings.customHighlightColors,
  );

  const {
    textures: customTextures,
    addTexture,
    loadTexture,
    applyTexture,
    removeTexture,
    loadCustomTextures,
    saveCustomTextures,
  } = useCustomTextureStore();
  const resetToDefaults = useResetViewSettings();

  const { selectFiles } = useFileSelector(appService, _);

  const handleReset = () => {
    resetToDefaults({
      overrideColor: setOverrideColor,
      invertImgColorInDark: setInvertImgColorInDark,
      codeHighlighting: setcodeHighlighting,
      codeLanguage: setCodeLanguage,
    });
    setThemeColor('default');
    setThemeMode('auto');
    setSelectedTextureId('none');
    setBackgroundOpacity(0.6);
    setBackgroundSize('cover');
    setCustomHighlightColors(HIGHLIGHT_COLOR_HEX);
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCustomTextures(envConfig);
  }, [loadCustomTextures, envConfig]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (overrideColor === viewSettings.overrideColor) return;
    saveViewSettings(envConfig, bookKey, 'overrideColor', overrideColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideColor]);

  useEffect(() => {
    let update = false; // check if we need to update syntax highlighting
    if (codeHighlighting !== viewSettings.codeHighlighting) {
      saveViewSettings(envConfig, bookKey, 'codeHighlighting', codeHighlighting);
      update = true;
    }
    if (codeLanguage !== viewSettings.codeLanguage) {
      saveViewSettings(envConfig, bookKey, 'codeLanguage', codeLanguage);
      update = true;
    }
    if (!update) return;
    const view = getView(bookKey);
    if (!view) return;
    const docs = view.renderer.getContents();
    docs.forEach(({ doc }) => manageSyntaxHighlighting(doc, viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeHighlighting, codeLanguage]);

  useEffect(() => {
    if (selectedTextureId === viewSettings.backgroundTextureId) return;
    saveViewSettings(envConfig, bookKey, 'backgroundTextureId', selectedTextureId);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTextureId]);

  useEffect(() => {
    if (backgroundOpacity === viewSettings.backgroundOpacity) return;
    saveViewSettings(envConfig, bookKey, 'backgroundOpacity', backgroundOpacity);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundOpacity]);

  useEffect(() => {
    if (backgroundSize === viewSettings.backgroundSize) return;
    saveViewSettings(envConfig, bookKey, 'backgroundSize', backgroundSize);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSize]);

  const applyBackgroundTexture = () => {
    applyTexture(envConfig, selectedTextureId);
    document.documentElement.style.setProperty('--bg-texture-opacity', `${backgroundOpacity}`);
    document.documentElement.style.setProperty('--bg-texture-size', backgroundSize);
  };

  useEffect(() => {
    const customThemes = settings.globalReadSettings.customThemes ?? [];
    setCustomThemes(
      customThemes.map((customTheme) => ({
        name: customTheme.name,
        label: customTheme.label,
        colors: {
          light: generateLightPalette(customTheme.colors.light),
          dark: generateDarkPalette(customTheme.colors.dark),
        },
        isCustomizale: true,
      })),
    );
  }, [settings]);

  const handleSaveCustomTheme = (customTheme: CustomTheme) => {
    applyCustomTheme(customTheme);
    saveCustomTheme(envConfig, settings, customTheme);

    setSettings({ ...settings });
    setThemeColor(customTheme.name);
    setShowCustomThemeEditor(false);
  };

  const handleDeleteCustomTheme = (customTheme: CustomTheme) => {
    saveCustomTheme(envConfig, settings, customTheme, true);

    setSettings({ ...settings });
    setThemeColor('default');
    setShowCustomThemeEditor(false);
  };

  const handleEditTheme = (name: string) => {
    const customTheme = settings.globalReadSettings.customThemes.find((t) => t.name === name);
    if (customTheme) {
      setEditTheme(customTheme);
      setShowCustomThemeEditor(true);
    }
  };

  const handleImportImage = () => {
    selectFiles({ type: 'images', multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      for (const selectedFile of result.files) {
        const textureInfo = await appService?.importImage(selectedFile.path || selectedFile.file);
        if (!textureInfo) continue;

        const customTexture = addTexture(textureInfo.path);
        console.log('Added custom texture:', customTexture);
        if (customTexture && !customTexture.error) {
          await loadTexture(envConfig, customTexture.id);
        }
      }
      saveCustomTextures(envConfig);
    });
  };

  const handleDeleteCustomTexture = (textureId: string) => {
    removeTexture(textureId);
    const updatedTextures = customTextures.filter((t) => t.id !== textureId);

    settings.customTextures = updatedTextures;
    setSettings(settings);

    if (selectedTextureId === textureId) {
      setSelectedTextureId('none');
    }
    saveCustomTextures(envConfig);
  };

  const allTextures = [...PREDEFINED_TEXTURES, ...customTextures.filter((t) => !t.deletedAt)];

  return (
    <div className='my-4 w-full space-y-6'>
      {showCustomThemeEditor ? (
        <ThemeEditor
          customTheme={editTheme}
          onSave={handleSaveCustomTheme}
          onDelete={handleDeleteCustomTheme}
          onCancel={() => setShowCustomThemeEditor(false)}
        />
      ) : (
        <>
          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Theme Mode')}</h2>
            <div className='flex gap-4'>
              <button
                title={_('Auto Mode')}
                className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
                onClick={() => setThemeMode('auto')}
              >
                <TbSunMoon />
              </button>
              <button
                title={_('Light Mode')}
                className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'light' ? 'btn-active bg-base-300' : ''}`}
                onClick={() => setThemeMode('light')}
              >
                <MdOutlineLightMode />
              </button>
              <button
                title={_('Dark Mode')}
                className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'dark' ? 'btn-active bg-base-300' : ''}`}
                onClick={() => setThemeMode('dark')}
              >
                <MdOutlineDarkMode />
              </button>
            </div>
          </div>

          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Invert Image In Dark Mode')}</h2>
            <input
              type='checkbox'
              className='toggle'
              checked={invertImgColorInDark}
              disabled={!isDarkMode}
              onChange={() => setInvertImgColorInDark(!invertImgColorInDark)}
            />
          </div>

          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Override Book Color')}</h2>
            <input
              type='checkbox'
              className='toggle'
              checked={overrideColor}
              onChange={() => setOverrideColor(!overrideColor)}
            />
          </div>

          <div>
            <h2 className='mb-2 font-medium'>{_('Theme Color')}</h2>
            <div className='grid grid-cols-3 gap-4'>
              {themes.concat(customThemes).map(({ name, label, colors, isCustomizale }) => (
                <button
                  key={name}
                  tabIndex={0}
                  onClick={() => setThemeColor(name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setThemeColor(name);
                    }
                    e.stopPropagation();
                  }}
                  className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg p-4 shadow-md ${
                    themeColor === name ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
                  }`}
                  style={{
                    backgroundColor: isDarkMode
                      ? colors.dark['base-100']
                      : colors.light['base-100'],
                    color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
                  }}
                >
                  <input
                    aria-label={_(label)}
                    type='radio'
                    name='theme'
                    value={name}
                    checked={themeColor === name}
                    onChange={() => setThemeColor(name)}
                    className='hidden'
                  />
                  {themeColor === name ? (
                    <MdRadioButtonChecked size={iconSize24} />
                  ) : (
                    <MdRadioButtonUnchecked size={iconSize24} />
                  )}
                  <span>{_(label)}</span>
                  {isCustomizale && themeColor === name && (
                    <button onClick={() => handleEditTheme(name)}>
                      <CgColorPicker size={iconSize16} className='absolute right-2 top-2' />
                    </button>
                  )}
                </button>
              ))}
              <button
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 shadow-md`}
                onClick={() => setShowCustomThemeEditor(true)}
              >
                <PiPlus size={iconSize24} />
                <span>{_('Custom')}</span>
              </button>
            </div>
          </div>

          <div>
            <h2 className='mb-2 font-medium'>{_('Background Image')}</h2>
            <div className='mb-4 grid grid-cols-2 gap-4'>
              {allTextures.map((texture) => (
                <button
                  key={texture.id}
                  onClick={() => setSelectedTextureId(texture.id)}
                  className={`bg-base-100 relative flex flex-col items-center justify-center rounded-lg border-2 p-4 shadow-md transition-all ${
                    selectedTextureId === texture.id
                      ? 'ring-2 ring-indigo-500 ring-offset-2'
                      : 'border-base-300'
                  }`}
                  style={{
                    backgroundImage: texture.loaded
                      ? `url("${texture.blobUrl || texture.url}")`
                      : 'none',
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
                  {!PREDEFINED_TEXTURES.find((t) => t.id === texture.id) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustomTexture(texture.id);
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
                className={`border-base-300 relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 shadow-md transition-all`}
                style={{ minHeight: '80px' }}
              >
                <button
                  className='card-body flex cursor-pointer items-center justify-center p-2 text-center'
                  onClick={handleImportImage}
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
                      onChange={(e) => setBackgroundOpacity(parseFloat(e.target.value))}
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
                    onChange={(e) => setBackgroundSize(e.target.value)}
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

          <div>
            <h2 className='mb-2 font-medium'>{_('Highlight Colors')}</h2>
            <div className='card border-base-200 bg-base-100 overflow-visible border p-4 shadow'>
              <div className='flex items-center justify-around gap-2'>
                {(['red', 'violet', 'blue', 'green', 'yellow'] as HighlightColor[]).map(
                  (color, index, array) => {
                    const position =
                      index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
                    return (
                      <div key={color} className='flex flex-col items-center gap-2'>
                        <div
                          className='border-base-300 h-8 w-8 rounded-full border-2 shadow-sm'
                          style={{ backgroundColor: customHighlightColors[color] }}
                        />
                        <ColorInput
                          label=''
                          value={customHighlightColors[color]}
                          compact={true}
                          pickerPosition={position}
                          onChange={(value: string) => {
                            customHighlightColors[color] = value;
                            setCustomHighlightColors({ ...customHighlightColors });
                            settings.globalReadSettings.customHighlightColors =
                              customHighlightColors;
                            setSettings(settings);
                          }}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          <div className='w-full'>
            <h2 className='mb-2 font-medium'>{_('Code Highlighting')}</h2>
            <div className='card border-base-200 bg-base-100 border shadow'>
              <div className='divide-base-200'>
                <div className='config-item'>
                  <span className=''>{_('Enable Highlighting')}</span>
                  <input
                    type='checkbox'
                    className='toggle'
                    checked={codeHighlighting}
                    onChange={() => setcodeHighlighting(!codeHighlighting)}
                  />
                </div>

                <div className='config-item'>
                  <span className=''>{_('Code Language')}</span>
                  <Select
                    value={codeLanguage}
                    onChange={(event) => setCodeLanguage(event.target.value as CodeLanguage)}
                    options={CODE_LANGUAGES.map((lang) => ({
                      value: lang,
                      label: lang === 'auto-detect' ? _('Auto') : lang,
                    }))}
                    disabled={!codeHighlighting}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ColorPanel;
