import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { normalizeNativeKey, normalizeDomKeyEvent } from '@/utils/hardwareKeys';
import { HardwarePageTurnerSettings, KeyBinding } from '@/types/settings';
import { BoxedList, SettingsRow, SettingsSwitchRow, Tips } from './primitives';

type Slot = 'pagePrev' | 'pageNext';
const LEARN_TIMEOUT_MS = 8000;

const PageTurnerSettings: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { setKeyLearnMode } = useDeviceControlStore();

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
    const other: Slot = slot === 'pagePrev' ? 'pageNext' : 'pagePrev';
    const bindings = { ...current.bindings, [slot]: binding };
    // A single key cannot drive both directions.
    if (
      bindings[other] &&
      bindings[other]!.source === binding.source &&
      bindings[other]!.id === binding.id
    ) {
      bindings[other] = null;
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

  // Disabling the feature exits any in-progress capture.
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
        <div className='flex items-center gap-2'>
          {binding && !isListening && (
            <button
              type='button'
              className='text-base-content/60 hover:text-base-content text-[0.85em]'
              disabled={!config.enabled}
              aria-label={`${_('Clear')}: ${label}`}
              onClick={() => persist({ ...config, bindings: { ...config.bindings, [slot]: null } })}
            >
              {_('Clear')}
            </button>
          )}
          <button
            type='button'
            className='eink-bordered rounded-md px-3 py-1 text-[0.85em]'
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
      <BoxedList title={_('Page Turner')} data-setting-id='settings.control.pageTurner'>
        <SettingsSwitchRow
          label={_('Hardware Page Turner')}
          checked={config.enabled}
          onChange={() => persist({ ...config, enabled: !config.enabled })}
        />
        {renderSlot('pagePrev', _('Previous Page'))}
        {renderSlot('pageNext', _('Next Page'))}
      </BoxedList>
      <Tips>
        <li>
          {_(
            'Press a button on your remote after tapping "Set key". Media-key support depends on your device and remote.',
          )}
        </li>
      </Tips>
    </div>
  );
};

export default PageTurnerSettings;
