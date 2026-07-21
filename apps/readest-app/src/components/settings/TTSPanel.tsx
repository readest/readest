import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import {
  TTSHighlightGranularity,
  TTSMediaMetadataMode,
  TTSPlayerStyle,
} from '@/services/tts/types';
import { getTTSCacheConfig, setTTSCacheConfig } from '@/services/tts/providers/bookCacheStore';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './theme/TTSHighlightStyleEditor';

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
  );
  const [ttsPlayerStyle, setTtsPlayerStyle] = useState<TTSPlayerStyle>(
    viewSettings.ttsPlayerStyle ?? 'full',
  );
  const [ttsHighlightGranularity, setTtsHighlightGranularity] = useState<TTSHighlightGranularity>(
    viewSettings.ttsHighlightGranularity ?? 'word',
  );
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
  );

  const [ttsCacheConfig, setTtsCacheConfigState] = useState(getTTSCacheConfig());

  const updateTTSCacheConfig = (config: typeof ttsCacheConfig) => {
    setTtsCacheConfigState(config);
    setTTSCacheConfig(config);
  };

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
      ttsPlayerStyle: setTtsPlayerStyle as React.Dispatch<React.SetStateAction<string>>,
      ttsHighlightGranularity: setTtsHighlightGranularity as React.Dispatch<
        React.SetStateAction<string>
      >,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ttsMediaMetadata === viewSettings.ttsMediaMetadata) return;
    saveViewSettings(envConfig, bookKey, 'ttsMediaMetadata', ttsMediaMetadata, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMediaMetadata]);

  useEffect(() => {
    if (ttsPlayerStyle === viewSettings.ttsPlayerStyle) return;
    saveViewSettings(envConfig, bookKey, 'ttsPlayerStyle', ttsPlayerStyle, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPlayerStyle]);

  useEffect(() => {
    if (ttsHighlightGranularity === viewSettings.ttsHighlightGranularity) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'ttsHighlightGranularity',
      ttsHighlightGranularity,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsHighlightGranularity]);

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

  const handleMediaMetadataChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTtsMediaMetadata(event.target.value as TTSMediaMetadataMode);
  };

  const handlePlayerStyleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTtsPlayerStyle(event.target.value as TTSPlayerStyle);
  };

  const handleTTSGranularityChange = (granularity: TTSHighlightGranularity) => {
    setTtsHighlightGranularity(granularity);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <TTSHighlightStyleEditor
        granularity={ttsHighlightGranularity}
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onGranularityChange={handleTTSGranularityChange}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
        <SettingsRow label={_('Player Style')} data-setting-id='settings.tts.playerStyle'>
          <SettingsSelect
            value={ttsPlayerStyle}
            onChange={handlePlayerStyleChange}
            ariaLabel={_('Player Style')}
            options={[
              { value: 'full', label: _('Full') },
              { value: 'minimal', label: _('Minimal') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={_('Update Frequency')}>
          <SettingsSelect
            value={ttsMediaMetadata}
            onChange={handleMediaMetadataChange}
            ariaLabel={_('Update Frequency')}
            options={[
              { value: 'sentence', label: _('Every Sentence') },
              { value: 'paragraph', label: _('Every Paragraph') },
              { value: 'chapter', label: _('Every Chapter') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Audio Cache')} data-setting-id='settings.tts.audioCache'>
        <SettingsSwitchRow
          label={_('Cache Synthesized Audio')}
          description={_('Reuse generated speech across sessions without refetching')}
          checked={ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, enabled: !ttsCacheConfig.enabled })
          }
          data-setting-id='settings.tts.audioCacheEnabled'
        />
        <SettingsSwitchRow
          label={_('Sync Audio Cache')}
          description={_('Share section audio between your devices through your file sync service')}
          checked={ttsCacheConfig.syncEnabled}
          disabled={!ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, syncEnabled: !ttsCacheConfig.syncEnabled })
          }
          data-setting-id='settings.tts.audioCacheSync'
        />
        <SettingsRow label={_('Storage Limit')}>
          <SettingsSelect
            value={String(ttsCacheConfig.budgetMB)}
            onChange={(event) =>
              updateTTSCacheConfig({
                ...ttsCacheConfig,
                budgetMB: Number(event.target.value),
              })
            }
            ariaLabel={_('Storage Limit')}
            disabled={!ttsCacheConfig.enabled}
            options={[
              { value: '50', label: '50 MB' },
              { value: '100', label: '100 MB' },
              { value: '200', label: '200 MB' },
              { value: '500', label: '500 MB' },
              { value: '1024', label: '1 GB' },
            ]}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default TTSPanel;
