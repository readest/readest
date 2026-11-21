import React, { useEffect, useMemo, useState } from 'react';
import { MdClose, MdSearch } from 'react-icons/md';
import { PiSpinner } from 'react-icons/pi';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { getBookProgress } from '@/store/readerProgressStore';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';
import { MULTILINGUAL_LANG } from '@/services/tts/types';
import { TTSUtils } from '@/services/tts/TTSUtils';
import type { VoiceLibrary } from '@/services/tts/voiceLibrary';
import { getPagePreviewText, getSampleText } from '@/services/tts/voicePreviewText';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import VoiceList, { getVoiceLanguageName } from '@/components/tts/VoiceList';
import { BoxedList, SettingsRow, SettingsSelect } from './primitives';
import SubPageHeader from './SubPageHeader';

interface TTSVoicesPageProps {
  library: VoiceLibrary | null;
  // The language to start on: the open book's (then the only one offered), or
  // the reader's UI language.
  lang: string;
  // The open book, whose current page the previews read; null from the library.
  bookKey: string | null;
  onBack: () => void;
  onDefaultChange: () => void;
  // The engine to show at first ('' for all of them): the one on show before a
  // sign-in round trip.
  initialSection: string;
  // Runs just before the page leaves for sign-in or the plans page (a locked
  // voice, or a Readest Voice preview signed out), with the engine on show.
  onLeave: (section: string) => void;
}

// One section of the list: an engine, or one custom service or system engine
// within it (those share an engine id).
const sectionKey = (group: TTSVoicesGroup) => `${group.engine}/${group.id}`;

// Voices for one language, each previewable, one of them chosen as the voice
// that language is read with. The engine picker narrows the list to one
// section; the filter, to the voices whose name or language matches.
const TTSVoicesPage: React.FC<TTSVoicesPageProps> = ({
  library,
  lang: initialLang,
  bookKey,
  onBack,
  onDefaultChange,
  initialSection,
  onLeave,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const [lang, setLang] = useState(initialLang);
  const [groups, setGroups] = useState<TTSVoicesGroup[] | null>(null);
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [defaultVoice, setDefaultVoice] = useState(() => TTSUtils.getDefaultVoice(initialLang));

  useEffect(() => {
    if (!library) return;
    let current = true;
    setGroups(null);
    library.getVoices(lang).then((result) => current && setGroups(result));
    return () => {
      current = false;
    };
  }, [library, lang]);

  // The section picked while this language has it, else every engine.
  const activeSection = groups?.some((group) => sectionKey(group) === section) ? section : '';
  const shownGroups =
    groups && activeSection
      ? groups.filter((group) => sectionKey(group) === activeSection)
      : groups;
  const sections = [
    { value: '', label: _('All') },
    ...(groups ?? []).map((group) => ({
      value: sectionKey(group),
      label: group.literalName ? group.name : _(group.name),
    })),
  ];

  // With a book open, the page being read, else a sample in the voice's
  // language; a multilingual voice reads the chosen language's.
  const preview = useVoicePreview(
    (voice: TTSVoice) => {
      const voiceLang = voice.lang === MULTILINGUAL_LANG ? lang : voice.lang;
      const pageText = bookKey ? getPagePreviewText(getBookProgress(bookKey)?.range, lang) : null;
      return pageText
        ? { text: pageText, lang }
        : { text: getSampleText(voiceLang), lang: voiceLang };
    },
    () => onLeave(activeSection),
  );

  const languages = useMemo(
    () =>
      (library?.languages ?? [lang])
        .map((code) => ({ value: code, label: getVoiceLanguageName(code) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [library, lang],
  );

  const handleSelect = (group: TTSVoicesGroup, voice: TTSVoice) => {
    if (!group.engine) return;
    TTSUtils.setDefaultVoice(group.engine, lang, voice.id);
    setDefaultVoice({ engine: group.engine, voiceId: voice.id });
    onDefaultChange();
  };

  const handleUpgrade = () => {
    onLeave(activeSection);
    if (user) navigateToProfile(router);
    else navigateToLogin(router);
  };

  const handleLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    preview.stop();
    setLang(event.target.value);
    setDefaultVoice(TTSUtils.getDefaultVoice(event.target.value));
  };

  const handleSectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    preview.stop();
    setSection(event.target.value);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('TTS')}
        currentLabel={_('Voice Library')}
        description={
          bookKey
            ? _('Preview voices with the page you are reading and choose one for this language')
            : _('Preview voices and choose the one each language is read with')
        }
        onBack={onBack}
      />
      <BoxedList>
        <SettingsRow label={_('Voice Engine')}>
          <SettingsSelect
            value={activeSection}
            onChange={handleSectionChange}
            ariaLabel={_('Voice Engine')}
            options={sections}
          />
        </SettingsRow>
        <SettingsRow label={_('Language')}>
          {bookKey ? (
            <span className='text-base-content/70 truncate'>{getVoiceLanguageName(lang)}</span>
          ) : (
            <SettingsSelect
              value={lang}
              onChange={handleLangChange}
              ariaLabel={_('Language')}
              options={languages}
            />
          )}
        </SettingsRow>
      </BoxedList>
      <div className='flex flex-col gap-4'>
        <div className='eink-bordered bg-base-100 focus-within:ring-base-content/15 eink:focus-within:ring-base-content flex h-9 w-full items-center rounded-lg focus-within:ring-2'>
          <MdSearch className='text-base-content/50 ms-3 h-4 w-4 shrink-0' />
          <input
            type='text'
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            // Keep Esc and typed keys from reaching the Settings dialog's handlers.
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={_('Filter voices')}
            aria-label={_('Filter voices')}
            className='settings-content min-w-0 flex-1 bg-transparent px-2 focus:outline-hidden'
          />
          {query && (
            <button
              type='button'
              onClick={() => setQuery('')}
              className='btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0'
              title={_('Clear')}
              aria-label={_('Clear')}
            >
              <MdClose className='text-base-content/60 h-4 w-4' />
            </button>
          )}
        </div>
        {shownGroups ? (
          // Remounted per engine, so each one starts with every gender shown.
          <VoiceList
            key={activeSection}
            groups={shownGroups}
            query={query}
            selected={defaultVoice}
            onSelect={handleSelect}
            onUpgrade={handleUpgrade}
            preview={preview}
          />
        ) : (
          <div className='flex justify-center py-8' aria-busy='true'>
            <PiSpinner className='text-base-content/60 h-6 w-6 animate-spin' />
          </div>
        )}
      </div>
    </div>
  );
};

export default TTSVoicesPage;
