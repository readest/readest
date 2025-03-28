import clsx from 'clsx';
import React, { useState, ChangeEvent, useEffect } from 'react';
import { MdPlayCircle, MdPauseCircle, MdFastRewind, MdFastForward, MdStop } from 'react-icons/md';
import { RiVoiceAiFill } from 'react-icons/ri';
import { MdCheck } from 'react-icons/md';
import { TTSVoice } from '@/services/tts';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDefaultIconSize, useResponsiveSize } from '@/hooks/useResponsiveSize';

type TTSPanelProps = {
  bookKey: string;
  ttsLang: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBackward: () => void;
  onForward: () => void;
  onStop: () => void;
  onSetRate: (rate: number) => void;
  onGetVoices: (lang: string) => Promise<TTSVoice[]>;
  onSetVoice: (voice: string) => void;
  onGetVoiceId: () => string;
};

const TTSPanel = ({
  bookKey,
  ttsLang,
  isPlaying,
  onTogglePlay,
  onBackward,
  onForward,
  onStop,
  onSetRate,
  onGetVoices,
  onSetVoice,
  onGetVoiceId,
}: TTSPanelProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey);

  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [rate, setRate] = useState(viewSettings?.ttsRate ?? 1.0);
  const [selectedVoice, setSelectedVoice] = useState(viewSettings?.ttsVoice ?? '');

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

  const handleSelectVoice = (voice: string) => {
    onSetVoice(voice);
    setSelectedVoice(voice);
    const viewSettings = getViewSettings(bookKey)!;
    viewSettings.ttsVoice = voice;
    setViewSettings(bookKey, viewSettings);
  };

  useEffect(() => {
    const voiceId = onGetVoiceId();
    setSelectedVoice(voiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchVoices = async () => {
      const voices = await onGetVoices(ttsLang);
      setVoices(voices);
    };
    fetchVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsLang]);

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
        <button onClick={onStop} className='rounded-full p-1'>
          <MdStop size={iconSize32} />
        </button>
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
            {voices.map((voice, index) => (
              <li
                key={`${index}-${voice.id}`}
                onClick={() => !voice.disabled && handleSelectVoice(voice.id)}
              >
                <div className='flex items-center px-2'>
                  <span style={{ minWidth: `${defaultIconSize}px` }}>
                    {selectedVoice === voice.id && <MdCheck className='text-base-content' />}
                  </span>
                  <span className={clsx('text-base sm:text-sm', voice.disabled && 'text-gray-400')}>
                    {voice.name}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default TTSPanel;
