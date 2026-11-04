import React, { useEffect, useMemo, useState } from 'react';
import { PiSpinner } from 'react-icons/pi';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
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
}

// Voices for one language, each previewable, one of them chosen as the voice
// that language is read with.
const TTSVoicesPage: React.FC<TTSVoicesPageProps> = ({
  library,
  lang: initialLang,
  bookKey,
  onBack,
  onDefaultChange,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const [lang, setLang] = useState(initialLang);
  const [groups, setGroups] = useState<TTSVoicesGroup[] | null>(null);
  const [defaultVoice, setDefaultVoice] = useState(() => TTSUtils.getDefaultVoice(initialLang));

  useKeyDownActions({ onCancel: onBack });

  useEffect(() => {
    if (!library) return;
    let current = true;
    setGroups(null);
    library.getVoices(lang).then((result) => current && setGroups(result));
    return () => {
      current = false;
    };
  }, [library, lang]);

  // With a book open, the page being read, else a sample in the voice's
  // language; a multilingual voice reads the chosen language's.
  const preview = useVoicePreview((voice: TTSVoice) => {
    const voiceLang = voice.lang === MULTILINGUAL_LANG ? lang : voice.lang;
    const pageText = bookKey ? getPagePreviewText(getBookProgress(bookKey)?.range, lang) : null;
    return pageText
      ? { text: pageText, lang }
      : { text: getSampleText(voiceLang), lang: voiceLang };
  });

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
    if (user) navigateToProfile(router);
    else navigateToLogin(router);
  };

  const handleLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    preview.stop();
    setLang(event.target.value);
    setDefaultVoice(TTSUtils.getDefaultVoice(event.target.value));
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
      {groups ? (
        <VoiceList
          groups={groups}
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
  );
};

export default TTSVoicesPage;
