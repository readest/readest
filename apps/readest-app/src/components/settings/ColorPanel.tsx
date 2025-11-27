import React, { useState, useEffect } from 'react';
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
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { saveViewSettings } from '@/helpers/settings';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { useFileSelector } from '@/hooks/useFileSelector';
import { PREDEFINED_TEXTURES } from '@/styles/textures';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import ThemeEditor from './color/ThemeEditor';
import ThemeModeSelector from './color/ThemeModeSelector';
import ThemeColorSelector from './color/ThemeColorSelector';
import BackgroundTextureSelector from './color/BackgroundTextureSelector';
import HighlightColorsEditor from './color/HighlightColorsEditor';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './color/TTSHighlightStyleEditor';
import CodeHighlightingSettings from './color/CodeHighlightingSettings';

const ColorPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor, saveCustomTheme } =
    useThemeStore();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings.invertImgColorInDark,
  );
  const [editTheme, setEditTheme] = useState<CustomTheme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [showCustomThemeEditor, setShowCustomThemeEditor] = useState(false);
  const [overrideColor, setOverrideColor] = useState(viewSettings.overrideColor);
  const [codeHighlighting, setcodeHighlighting] = useState(viewSettings.codeHighlighting);
  const [codeLanguage, setCodeLanguage] = useState(viewSettings.codeLanguage);
  const [selectedTextureId, setSelectedTextureId] = useState(viewSettings.backgroundTextureId);
  const [backgroundOpacity, setBackgroundOpacity] = useState(viewSettings.backgroundOpacity);
  const [backgroundSize, setBackgroundSize] = useState(viewSettings.backgroundSize);
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customHighlightColors, setCustomHighlightColors] = useState(
    settings.globalReadSettings.customHighlightColors,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
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
    let update = false;
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

  const handleHighlightColorsChange = (colors: typeof customHighlightColors) => {
    setCustomHighlightColors(colors);
    settings.globalReadSettings.customHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleTTSStyleChange = (style: TTSHighlightStyle) => {
    setTtsHighlightStyle(style);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style,
      color: ttsHighlightColor,
    });
  };

  const handleTTSColorChange = (color: string) => {
    setTtsHighlightColor(color);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style: ttsHighlightStyle,
      color,
    });
  };

  const handleCustomTtsColorsChange = (colors: string[]) => {
    setCustomTtsHighlightColors(colors);
    settings.globalReadSettings.customTtsHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

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
          <ThemeModeSelector themeMode={themeMode} onThemeModeChange={setThemeMode} />

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

          <ThemeColorSelector
            themes={themes.concat(customThemes)}
            themeColor={themeColor}
            isDarkMode={isDarkMode}
            onThemeColorChange={setThemeColor}
            onEditTheme={handleEditTheme}
            onCreateTheme={() => setShowCustomThemeEditor(true)}
          />

          <BackgroundTextureSelector
            predefinedTextures={PREDEFINED_TEXTURES}
            customTextures={customTextures.filter((t) => !t.deletedAt)}
            selectedTextureId={selectedTextureId}
            backgroundOpacity={backgroundOpacity}
            backgroundSize={backgroundSize}
            onTextureSelect={setSelectedTextureId}
            onOpacityChange={setBackgroundOpacity}
            onSizeChange={setBackgroundSize}
            onImportImage={handleImportImage}
            onDeleteTexture={handleDeleteCustomTexture}
          />

          <HighlightColorsEditor
            customHighlightColors={customHighlightColors}
            onChange={handleHighlightColorsChange}
          />

          <TTSHighlightStyleEditor
            style={ttsHighlightStyle}
            color={ttsHighlightColor}
            customColors={customTtsHighlightColors}
            onStyleChange={handleTTSStyleChange}
            onColorChange={handleTTSColorChange}
            onCustomColorsChange={handleCustomTtsColorsChange}
          />

          <CodeHighlightingSettings
            codeHighlighting={codeHighlighting}
            codeLanguage={codeLanguage}
            onToggle={setcodeHighlighting}
            onLanguageChange={setCodeLanguage}
          />
        </>
      )}
    </div>
  );
};

export default ColorPanel;
