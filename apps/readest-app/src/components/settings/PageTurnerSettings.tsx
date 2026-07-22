import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { saveSysSettings, saveViewSettings } from '@/helpers/settings';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { eventDispatcher } from '@/utils/event';
import {
  normalizeNativeKey,
  normalizeDomKeyEvent,
  PAGE_TURN_ACTIONS,
  PageTurnAction,
} from '@/utils/keybinding';
import { HardwarePageTurnerSettings, KeyBinding } from '@/types/settings';
import { BoxedList, SettingsRow, SettingsSwitchRow } from './primitives';
import { useReaderStore } from '@/store/readerStore';

type Slot = PageTurnAction;
const LEARN_TIMEOUT_MS = 8000;

interface PageTurnerSettingsProps {
  bookKey: string;
  onRegisterReset?: (resetFn: () => void) => void;
}

const PageTurnerSettings: React.FC<PageTurnerSettingsProps> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { setKeyLearnMode, acquireVolumeKeyInterception, releaseVolumeKeyInterception } =
    useDeviceControlStore();
  const { settings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const resetToDefaults = useResetViewSettings();

  const [volumeKeysToFlip, setVolumeKeysToFlip] = useState(viewSettings.volumeKeysToFlip);
  const [config, setConfig] = useState<HardwarePageTurnerSettings>(settings.hardwarePageTurner);
  const configRef = useRef(config);
  configRef.current = config;
  const [listening, setListening] = useState<Slot | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = (next: HardwarePageTurnerSettings) => {
    setConfig(next);
    saveSysSettings(envConfig, 'hardwarePageTurner', next);
  };

  // Native key interception exists only on mobile; on web and desktop
  // learn mode relies on standard DOM keydown events alone.
  const setNativeLearnMode = (enabled: boolean) => {
    if (appService?.isMobileApp) setKeyLearnMode(enabled);
  };

  const stopListening = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setNativeLearnMode(false);
    setListening(null);
  };

  const captureBinding = (slot: Slot, binding: KeyBinding) => {
    const current = configRef.current;
    const bindings = { ...current.bindings, [slot]: binding };
    // A key can drive only one action — clear it from every other slot.
    for (const other of PAGE_TURN_ACTIONS) {
      if (
        other !== slot &&
        bindings[other]?.source === binding.source &&
        bindings[other]?.id === binding.id
      ) {
        bindings[other] = null;
      }
    }
    persist({ ...current, bindings });
    stopListening();
  };

  useEffect(() => {
    if (!listening) return;

    const onNativeKey = (msg: CustomEvent) => {
      const keyName = msg.detail?.keyName;
      if (typeof keyName !== 'string') return;
      // Back, and volume keys (which have their own dedicated page-flip
      // toggle), are not bindable here — binding them would be inert or
      // would double-fire alongside the volume-keys handler.
      if (keyName === 'Back' || keyName === 'VolumeUp' || keyName === 'VolumeDown') return;
      captureBinding(listening, normalizeNativeKey(keyName));
    };
    const onDomKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      captureBinding(listening, normalizeDomKeyEvent(event));
    };

    setNativeLearnMode(true);
    eventDispatcher.on('native-key-down', onNativeKey);
    window.addEventListener('keydown', onDomKey, true);
    timeoutRef.current = setTimeout(stopListening, LEARN_TIMEOUT_MS);

    return () => {
      eventDispatcher.off('native-key-down', onNativeKey);
      window.removeEventListener('keydown', onDomKey, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setNativeLearnMode(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'volumeKeysToFlip', volumeKeysToFlip, false, false);
    if (appService?.isMobileApp) {
      if (volumeKeysToFlip) {
        acquireVolumeKeyInterception();
      } else {
        releaseVolumeKeyInterception();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeKeysToFlip]);

  useEffect(() => {
    onRegisterReset?.(() => resetToDefaults({ volumeKeysToFlip: setVolumeKeysToFlip }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!config.enabled && listening) stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled]);

  const renderSlot = (slot: Slot, label: string) => {
    const binding = config.bindings[slot];
    const isListening = listening === slot;
    return (
      <SettingsRow
        label={label}
        disabled={!config.enabled}
        data-setting-id={`settings.control.pageTurner.${slot}`}
      >
        <div className='flex items-center gap-5'>
          {binding && !isListening && (
            <button
              type='button'
              className='text-base-content/70 hover:text-base-content text-end text-[0.85em] focus:outline-none'
              disabled={!config.enabled}
              aria-label={`${_('Clear')}: ${label}`}
              onClick={() => persist({ ...config, bindings: { ...config.bindings, [slot]: null } })}
            >
              {_('Clear')}
            </button>
          )}
          <button
            type='button'
            className='text-base-content/70 hover:text-base-content py-1 text-end text-[0.85em] focus:outline-none'
            disabled={!config.enabled}
            aria-pressed={isListening}
            aria-label={`${label}: ${isListening ? _('Listening…') : _('Set key')}`}
            onClick={() => (isListening ? stopListening() : setListening(slot))}
          >
            {isListening ? _('Listening…') : binding ? _(binding.label) : _('Set key')}
          </button>
        </div>
      </SettingsRow>
    );
  };

  return (
    <div className='space-y-2'>
      <BoxedList
        title={_('Page Turner')}
        data-setting-id='settings.control.pageTurner'
        description={_(
          'Press a button on your remote controller or keyboard after tapping "Set key".',
        )}
      >
        {appService?.isMobileApp && (
          <SettingsSwitchRow
            label={_('Use Volume Keys')}
            checked={volumeKeysToFlip}
            onChange={() => setVolumeKeysToFlip(!volumeKeysToFlip)}
          />
        )}
        <SettingsSwitchRow
          label={_('Custom Page Turner')}
          checked={config.enabled}
          onChange={() => persist({ ...config, enabled: !config.enabled })}
        />
        {renderSlot('pagePrev', _('Previous Page'))}
        {renderSlot('pageNext', _('Next Page'))}
        {renderSlot('sectionPrev', _('Previous Section'))}
        {renderSlot('sectionNext', _('Next Section'))}
        {/* Deep e-ink refresh clears ghosting; only meaningful in e-ink mode
            on Android, where the native bridge can drive the panel. */}
        {appService?.isAndroidApp &&
          viewSettings.isEink &&
          renderSlot('refresh', _('Refresh Page'))}
      </BoxedList>
    </div>
  );
};

export default PageTurnerSettings;
