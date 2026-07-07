import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  MdAlarm,
  MdArrowBackIosNew,
  MdCheck,
  MdFastForward,
  MdFastRewind,
  MdOutlinePause,
  MdPlayArrow,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { RiVoiceAiFill } from 'react-icons/ri';
import { TTSVoicesGroup } from '@/services/tts';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { getLanguageName } from '@/utils/lang';
import { formatPlaybackTime } from '@/utils/time';
import Dialog from '@/components/Dialog';
import { BoxedList, NavigationRow } from '@/components/settings/primitives';
import { TTSPlaybackInfo } from './usePlaybackInfo';
import { useCountdownLabel } from './useCountdownLabel';
import TTSScrubber from './TTSScrubber';
import SpeedChips from './SpeedChips';

type SheetView = 'main' | 'voice' | 'timer';

const getTTSTimeoutOptions = (_: TranslationFunc) => {
  return [
    { label: _('No Timeout'), value: 0 },
    { label: _('{{value}} minute', { value: 1 }), value: 60 },
    { label: _('{{value}} minutes', { value: 3 }), value: 180 },
    { label: _('{{value}} minutes', { value: 5 }), value: 300 },
    { label: _('{{value}} minutes', { value: 10 }), value: 600 },
    { label: _('{{value}} minutes', { value: 20 }), value: 1200 },
    { label: _('{{value}} minutes', { value: 30 }), value: 1800 },
    { label: _('{{value}} minutes', { value: 45 }), value: 2700 },
    { label: _('{{value}} hour', { value: 1 }), value: 3600 },
    { label: _('{{value}} hours', { value: 2 }), value: 7200 },
    { label: _('{{value}} hours', { value: 3 }), value: 10800 },
    { label: _('{{value}} hours', { value: 4 }), value: 14400 },
    { label: _('{{value}} hours', { value: 6 }), value: 21600 },
    { label: _('{{value}} hours', { value: 8 }), value: 28800 },
  ];
};

type TTSPlayerSheetProps = {
  bookKey: string;
  isOpen: boolean;
  ttsLang: string;
  isPlaying: boolean;
  hasTimeline: boolean;
  timeoutOption: number;
  timeoutTimestamp: number;
  chapterRemainingSec: number | null;
  onClose: () => void;
  onTogglePlay: () => void;
  onBackward: (byMark: boolean) => void;
  onForward: (byMark: boolean) => void;
  onSetRate: (rate: number) => void;
  onGetVoices: (lang: string) => Promise<TTSVoicesGroup[]>;
  onSetVoice: (voice: string, lang: string) => void;
  onGetVoiceId: () => string;
  onSelectTimeout: (bookKey: string, value: number) => void;
  onSeek: (seconds: number) => Promise<void>;
  onGetPlaybackInfo: () => TTSPlaybackInfo | null;
};

// Full player sheet: cover, chapter, scrubber, transport, speed chips, and
// voice / sleep-timer rows that drill into in-sheet sub-views (dropdowns
// clip inside the dialog's scroll container).
const TTSPlayerSheet = ({
  bookKey,
  isOpen,
  ttsLang,
  isPlaying,
  hasTimeline,
  timeoutOption,
  timeoutTimestamp,
  chapterRemainingSec,
  onClose,
  onTogglePlay,
  onBackward,
  onForward,
  onSetRate,
  onGetVoices,
  onSetVoice,
  onGetVoiceId,
  onSelectTimeout,
  onSeek,
  onGetPlaybackInfo,
}: TTSPlayerSheetProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const [view, setView] = useState<SheetView>('main');
  const [voiceGroups, setVoiceGroups] = useState<TTSVoicesGroup[]>([]);
  const [rate, setRate] = useState(viewSettings?.ttsRate ?? 1.0);
  const [selectedVoice, setSelectedVoice] = useState('');
  const timerLabel = useCountdownLabel(timeoutTimestamp);
  const iconSize24 = useResponsiveSize(24);
  const iconSize32 = useResponsiveSize(32);

  const book = getBookData(bookKey)?.book;
  const sectionLabel = progress?.sectionLabel;
  const isEink = viewSettings?.isEink ?? false;

  // Fresh open: land on the main view with current rate/voice.
  useEffect(() => {
    if (!isOpen) return;
    setView('main');
    setRate(getViewSettings(bookKey)?.ttsRate ?? 1.0);
    setSelectedVoice(onGetVoiceId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchVoices = async () => {
      const groups = await onGetVoices(ttsLang);
      const voicesCount = groups.reduce((acc, group) => acc + group.voices.length, 0);
      if (!groups || voicesCount === 0) {
        setVoiceGroups([
          {
            id: 'no-voices',
            name: _('Voices for {{lang}}', { lang: getLanguageName(ttsLang) }),
            voices: [],
          },
        ]);
      } else {
        setVoiceGroups(groups);
      }
    };
    fetchVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ttsLang]);

  const handleSelectRate = (value: number) => {
    setRate(value);
    onSetRate(value);
    const vs = getViewSettings(bookKey)!;
    vs.ttsRate = value;
    setViewSettings(bookKey, vs);
    // Read the store fresh at call time: a `settings` captured at render goes
    // stale if anything else persisted settings since this sheet mounted.
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    settings.globalViewSettings.ttsRate = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleSelectVoice = (voice: string, lang: string) => {
    onSetVoice(voice, lang);
    setSelectedVoice(voice);
    const vs = getViewSettings(bookKey)!;
    vs.ttsVoice = voice;
    setViewSettings(bookKey, vs);
    setView('main');
  };

  const handleSelectTimeout = (value: number) => {
    onSelectTimeout(bookKey, value);
    setView('main');
  };

  const timeoutOptions = getTTSTimeoutOptions(_);
  const currentVoiceName = voiceGroups
    .flatMap((group) => group.voices)
    .find((voice) => voice.id === selectedVoice)?.name;
  const timerStatus =
    timeoutOption > 0 && timerLabel
      ? timerLabel
      : timeoutOptions.find((option) => option.value === timeoutOption)?.label;

  const header = (
    <div className='relative flex h-11 w-full items-center px-1'>
      {view !== 'main' ? (
        <button
          type='button'
          aria-label={_('Go Back')}
          onClick={() => setView('main')}
          className='btn btn-ghost btn-circle z-10 flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-none'
        >
          <MdArrowBackIosNew size={iconSize24 * 0.8} className='rtl:rotate-180' />
        </button>
      ) : (
        <span className='w-8' />
      )}
      <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
        <span className='line-clamp-1 text-center font-bold'>
          {view === 'voice'
            ? _('Select Voice')
            : view === 'timer'
              ? _('Set Timeout')
              : _('Read Aloud')}
        </span>
      </div>
    </div>
  );

  return (
    <Dialog
      id='tts_player_sheet'
      isOpen={isOpen}
      snapHeight={0.65}
      title={_('Read Aloud')}
      header={header}
      boxClassName='sm:!h-auto sm:!max-h-[85%] sm:!w-[420px] sm:!min-w-0'
      contentClassName='!px-4 sm:!px-4'
      onClose={onClose}
    >
      {view === 'main' && (
        <div className='flex w-full flex-col items-center gap-4 pb-4'>
          {book?.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImageUrl}
              alt=''
              className='not-eink:shadow-lg eink-bordered h-32 w-auto rounded-xl object-cover'
            />
          ) : null}
          <div className='flex w-full flex-col items-center gap-0.5 text-center'>
            <span className='line-clamp-1 font-semibold'>{book?.title ?? ''}</span>
            {sectionLabel && (
              <span className='text-base-content/70 line-clamp-1 text-sm'>{sectionLabel}</span>
            )}
          </div>
          {hasTimeline ? (
            <TTSScrubber
              bookKey={bookKey}
              isEink={isEink}
              onSeek={onSeek}
              onGetPlaybackInfo={onGetPlaybackInfo}
            />
          ) : (
            chapterRemainingSec !== null && (
              <span className='text-base-content/70 text-xs'>
                {_('{{time}} left in chapter', { time: formatPlaybackTime(chapterRemainingSec) })}
              </span>
            )
          )}
          <div dir='ltr' className='flex items-center justify-center gap-1'>
            <button
              type='button'
              className='rounded-full p-2'
              title={_('Previous Paragraph')}
              aria-label={_('Previous Paragraph')}
              onClick={() => onBackward(false)}
            >
              <MdFastRewind size={iconSize24} />
            </button>
            <button
              type='button'
              className='rounded-full p-2'
              title={_('Previous Sentence')}
              aria-label={_('Previous Sentence')}
              onClick={() => onBackward(true)}
            >
              <MdSkipPrevious size={iconSize32} />
            </button>
            <button
              type='button'
              className='btn btn-primary btn-circle mx-2 h-14 min-h-14 w-14'
              aria-label={isPlaying ? _('Pause') : _('Play')}
              onClick={onTogglePlay}
            >
              {isPlaying ? <MdOutlinePause size={iconSize32} /> : <MdPlayArrow size={iconSize32} />}
            </button>
            <button
              type='button'
              className='rounded-full p-2'
              title={_('Next Sentence')}
              aria-label={_('Next Sentence')}
              onClick={() => onForward(true)}
            >
              <MdSkipNext size={iconSize32} />
            </button>
            <button
              type='button'
              className='rounded-full p-2'
              title={_('Next Paragraph')}
              aria-label={_('Next Paragraph')}
              onClick={() => onForward(false)}
            >
              <MdFastForward size={iconSize24} />
            </button>
          </div>
          <SpeedChips rate={rate} onSelect={handleSelectRate} />
          <BoxedList className='w-full'>
            <NavigationRow
              icon={RiVoiceAiFill}
              title={_('Voice')}
              status={currentVoiceName}
              onClick={() => setView('voice')}
            />
            <NavigationRow
              icon={MdAlarm}
              title={_('Sleep Timer')}
              status={timerStatus}
              onClick={() => setView('timer')}
            />
          </BoxedList>
        </div>
      )}
      {view === 'voice' && (
        <div className='flex w-full flex-col pb-4'>
          {voiceGroups.map((voiceGroup) => (
            <div key={voiceGroup.id}>
              <div className='text-base-content/60 px-2 py-1 text-sm sm:text-xs'>
                {_('{{engine}}: {{count}} voices', {
                  engine: _(voiceGroup.name),
                  count: voiceGroup.voices.length,
                })}
              </div>
              {voiceGroup.voices.map((voice) => (
                <button
                  key={`${voiceGroup.id}-${voice.id}`}
                  type='button'
                  disabled={voice.disabled}
                  onClick={() => handleSelectVoice(voice.id, voice.lang)}
                  className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start'
                >
                  <span className='flex h-6 w-6 items-center justify-center'>
                    {selectedVoice === voice.id && <MdCheck className='text-base-content' />}
                  </span>
                  <span
                    className={clsx(
                      'overflow-hidden text-ellipsis text-base sm:text-sm',
                      voice.disabled && 'text-base-content/40',
                    )}
                  >
                    {_(voice.name)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {view === 'timer' && (
        <div className='flex w-full flex-col pb-4'>
          {timeoutOptions.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => handleSelectTimeout(option.value)}
              className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start'
            >
              <span className='flex h-6 w-6 items-center justify-center'>
                {timeoutOption === option.value && <MdCheck className='text-base-content' />}
              </span>
              <span className='text-base sm:text-sm'>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
};

export default TTSPlayerSheet;
