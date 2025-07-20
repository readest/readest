import clsx from 'clsx';
import React, { useState, ChangeEvent, useEffect } from 'react';
import { MdPlayCircle, MdPauseCircle, MdFastRewind, MdFastForward, MdAlarm } from 'react-icons/md';
import { RiVoiceAiFill } from 'react-icons/ri';
import { MdCheck } from 'react-icons/md';
import { TTSVoicesGroup } from '@/services/tts';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDefaultIconSize, useResponsiveSize } from '@/hooks/useResponsiveSize';
import { getLanguageName } from '@/utils/lang';

type TTSPanelProps = {
  bookKey: string;
  ttsLang: string;
  isPlaying: boolean;
  timeoutOption: number;
  timeoutTimestamp: number;
  onTogglePlay: () => void;
  onBackward: () => void;
  onForward: () => void;
  onSetRate: (rate: number) => void;
  onGetVoices: (lang: string) => Promise<TTSVoicesGroup[]>;
  onSetVoice: (voice: string, lang: string) => void;
  onGetVoiceId: () => string;
  onSelectTimeout: (bookKey: string, value: number) => void;
};

const getTTSTimeoutOptions = (_: TranslationFunc) => {
  return [
    {
      label: _('No Timeout'),
      value: 0,
    },
    {
      label: _('{{value}} minute', { value: 1 }),
      value: 60,
    },
    {
      label: _('{{value}} minutes', { value: 3 }),
      value: 180,
    },
    {
      label: _('{{value}} minutes', { value: 5 }),
      value: 300,
    },
    {
      label: _('{{value}} minutes', { value: 10 }),
      value: 600,
    },
    {
      label: _('{{value}} minutes', { value: 20 }),
      value: 1200,
    },
    {
      label: _('{{value}} minutes', { value: 30 }),
      value: 1800,
    },
    {
      label: _('{{value}} minutes', { value: 45 }),
      value: 2700,
    },
    {
      label: _('{{value}} hour', { value: 1 }),
      value: 3600,
    },
    {
      label: _('{{value}} hours', { value: 2 }),
      value: 7200,
    },
    {
      label: _('{{value}} hours', { value: 3 }),
      value: 10800,
    },
    {
      label: _('{{value}} hours', { value: 4 }),
      value: 14400,
    },
    {
      label: _('{{value}} hours', { value: 6 }),
      value: 21600,
    },
    {
      label: _('{{value}} hours', { value: 8 }),
      value: 28800,
    },
  ];
};

const getCountdownTime = (timeout: number) => {
  const now = Date.now();
  if (timeout > now) {
    const remainingTime = Math.floor((timeout - now) / 1000);
    const minutes = Math.floor(remainingTime / 3600) * 60 + Math.floor((remainingTime % 3600) / 60);
    const seconds = remainingTime % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return '';
};

const TTSPanel = ({
  bookKey,
  ttsLang,
  isPlaying,
  timeoutOption,
  timeoutTimestamp,
  onTogglePlay,
  onBackward,
  onForward,
  onSetRate,
  onGetVoices,
  onSetVoice,
  onGetVoiceId,
  onSelectTimeout,
}: TTSPanelProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey);

  const [voiceGroups, setVoiceGroups] = useState<TTSVoicesGroup[]>([]);
  const [rate, setRate] = useState(viewSettings?.ttsRate ?? 1.0);
  const [selectedVoice, setSelectedVoice] = useState(viewSettings?.ttsVoice ?? '');

  const [timeoutCountdown, setTimeoutCountdown] = useState(() => {
    return getCountdownTime(timeoutTimestamp);
  });

  const defaultIconSize = useDefaultIconSize();
  const iconSize32 = useResponsiveSize(32);
  const iconSize48 = useResponsiveSize(48);

  const handleSetRate = (e: ChangeEvent<HTMLInputElement>) => {
    let newRate = parseFloat(e.target.value);
    newRate = Math.max(0.2, Math.min(3.0, newRate));
    setRate(newRate);
    onSetRate(newRate);
    const viewSettings = getViewSettings(bookKey)!;
    viewSettings.ttsRate = newRate;
    settings.globalViewSettings.ttsRate = newRate;
    setViewSettings(bookKey, viewSettings);
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleSelectVoice = (voice: string, lang: string) => {
    onSetVoice(voice, lang);
    setSelectedVoice(voice);
    const viewSettings = getViewSettings(bookKey)!;
    viewSettings.ttsVoice = voice;
    setViewSettings(bookKey, viewSettings);
  };

  const updateTimeout = (timeout: number) => {
    const now = Date.now();
    if (timeout > 0 && timeout < now) {
      onSelectTimeout(bookKey, 0);
      setTimeoutCountdown('');
    } else if (timeout > 0) {
      setTimeoutCountdown(getCountdownTime(timeout));
    }
  };

  useEffect(() => {
    setTimeout(() => {
      updateTimeout(timeoutTimestamp);
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutTimestamp, timeoutCountdown]);

  useEffect(() => {
    const voiceId = onGetVoiceId();
    setSelectedVoice(voiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchVoices = async () => {
      const voiceGroups = await onGetVoices(ttsLang);
      const voicesCount = voiceGroups.reduce((acc, group) => acc + group.voices.length, 0);
      if (!voiceGroups || voicesCount === 0) {
        console.warn('No voices found for TTSPanel');
        setVoiceGroups([
          {
            id: 'no-voices',
            name: _('Voices for {{lang}}', { lang: getLanguageName(ttsLang) }),
            voices: [],
          },
        ]);
      } else {
        setVoiceGroups(voiceGroups);
      }
    };
    fetchVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsLang]);

  const timeoutOptions = getTTSTimeoutOptions(_);

  return (
    <div className='flex w-full flex-col items-center justify-center gap-2 rounded-2xl p-4'>
      <div className='flex w-full flex-col items-center gap-0.5'>
        <input
          className='range'
          type='range'
          min={0.0}
          max={3.0}
          step='0.1'
          value={rate}
          onChange={handleSetRate}
        />
        <div className='grid w-full grid-cols-7 text-xs'>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
        </div>
        <div className='grid w-full grid-cols-7 text-xs'>
          <span className='text-center'>{_('Slow')}</span>
          <span className='text-center'></span>
          <span className='text-center'>1.0</span>
          <span className='text-center'>1.5</span>
          <span className='text-center'>2.0</span>
          <span className='text-center'></span>
          <span className='text-center'>{_('Fast')}</span>
        </div>
      </div>
      <div className='flex items-center justify-between space-x-2'>
        <button onClick={onBackward} className='rounded-full p-1'>
          <MdFastRewind size={iconSize32} />
        </button>
        <button onClick={onTogglePlay} className='rounded-full p-1'>
          {isPlaying ? (
            <MdPauseCircle size={iconSize48} className='fill-primary' />
          ) : (
            <MdPlayCircle size={iconSize48} className='fill-primary' />
          )}
        </button>
        <button onClick={onForward} className='rounded-full p-1'>
          <MdFastForward size={iconSize32} />
        </button>
        <div className='dropdown dropdown-top'>
          <button
            tabIndex={0}
            className='flex flex-col items-center justify-center rounded-full p-1'
          >
            <MdAlarm size={iconSize32} />
            {timeoutCountdown && (
              <span
                className={clsx(
                  'absolute bottom-0 left-1/2 w-12 translate-x-[-50%] translate-y-[80%] px-1',
                  'bg-primary/80 text-base-100 rounded-full text-center text-xs',
                )}
              >
                {timeoutCountdown}
              </span>
            )}
          </button>
          <ul
            tabIndex={0}
            className={clsx(
              'dropdown-content bgcolor-base-200 no-triangle menu menu-vertical rounded-box absolute right-0 z-[1] shadow',
              'mt-4 inline max-h-96 w-[200px] overflow-y-scroll',
            )}
          >
            {timeoutOptions.map((option, index) => (
              <li
                key={`${index}-${option.value}`}
                onClick={() => onSelectTimeout(bookKey, option.value)}
              >
                <div className='flex items-center px-2'>
                  <span
                    style={{
                      width: `${defaultIconSize}px`,
                      height: `${defaultIconSize}px`,
                    }}
                  >
                    {timeoutOption === option.value && <MdCheck className='text-base-content' />}
                  </span>
                  <span className={clsx('text-base sm:text-sm')}>{option.label}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className='dropdown dropdown-top'>
          <button tabIndex={0} className='rounded-full p-1'>
            <RiVoiceAiFill size={iconSize32} />
          </button>
          <ul
            tabIndex={0}
            className={clsx(
              'dropdown-content bgcolor-base-200 no-triangle menu menu-vertical rounded-box absolute right-0 z-[1] shadow',
              'mt-4 inline max-h-96 w-[250px] overflow-y-scroll',
            )}
          >
            {voiceGroups.map((voiceGroup, index) => {
              return (
                <div key={voiceGroup.id} className=''>
                  <div className='flex items-center gap-2 px-2 py-1'>
                    <span
                      style={{ width: `${defaultIconSize}px`, height: `${defaultIconSize}px` }}
                    ></span>
                    <span className='text-sm text-gray-400 sm:text-xs'>
                      {_('{{engine}}: {{count}} voices', {
                        engine: _(voiceGroup.name),
                        count: voiceGroup.voices.length,
                      })}
                    </span>
                  </div>
                  {voiceGroup.voices.map((voice, voiceIndex) => (
                    <li
                      key={`${index}-${voiceGroup.id}-${voiceIndex}`}
                      onClick={() => !voice.disabled && handleSelectVoice(voice.id, voice.lang)}
                    >
                      <div className='flex items-center px-2'>
                        <span
                          style={{
                            width: `${defaultIconSize}px`,
                            height: `${defaultIconSize}px`,
                          }}
                        >
                          {selectedVoice === voice.id && <MdCheck className='text-base-content' />}
                        </span>
                        <span
                          className={clsx(
                            'max-w-[180px] overflow-hidden text-ellipsis text-base sm:text-sm',
                            voice.disabled && 'text-gray-400',
                          )}
                        >
                          {_(voice.name)}
                        </span>
                      </div>
                    </li>
                  ))}
                </div>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default TTSPanel;
