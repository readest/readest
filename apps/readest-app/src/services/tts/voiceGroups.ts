import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import type { SpeechProvider } from './providers/types';
import { MULTILINGUAL_LANG, type TTSVoice, type TTSVoicesGroup } from './types';
import { TTSUtils } from './TTSUtils';

// A synthetic engine's voices for a language, as its picker groups list them.
// `engine` is the client's persisted name; `unavailable` greys the groups out.
export const groupProviderVoices = (
  provider: Pick<SpeechProvider, 'label' | 'compareVoices' | 'groupVoices'>,
  engine: string,
  voices: TTSVoice[],
  lang: string,
  unavailable: boolean,
): TTSVoicesGroup[] => {
  if (provider.groupVoices) {
    // Each group offers the book language's voices and the multilingual ones.
    const spoken = voices.filter((v) => v.lang === MULTILINGUAL_LANG || isSameLang(v.lang, lang));
    return provider
      .groupVoices(spoken)
      .map((group) => ({ ...group, engine, disabled: unavailable }));
  }
  // Match by primary language so the voice set stays the same across a book
  // whose sections mix region variants (e.g. en-US front matter and en-GB
  // body text); the requested locale's voices sort first. See #4033.
  const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
  const filteredVoices = voices.filter((v) => isSameLang(v.lang, lang));
  return [
    {
      id: engine,
      name: provider.label,
      engine,
      voices: filteredVoices.sort(
        provider.compareVoices
          ? (a, b) => provider.compareVoices!(a, b)
          : TTSUtils.sortVoicesPreferLocaleFunc(locale),
      ),
      disabled: unavailable || filteredVoices.length === 0,
    },
  ];
};
