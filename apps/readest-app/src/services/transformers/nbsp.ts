import { normalizedLangCode } from '@/utils/lang';
import type { Transformer } from './types';

interface NbspLanguageConfig {
  // Unicode script name (for `\p{Script=...}`). Drives the generic short-word
  // rule and the "next char belongs to this language" look-ahead.
  script: string;
  // Function words (prepositions, conjunctions, particles) of three or more
  // letters that must not be left hanging at the end of a line. One- and
  // two-letter words are matched generically by the script rule, so only the
  // longer ones are listed here. Content words (nouns/verbs) are deliberately
  // excluded so we never glue after them.
  shortWords: string[];
}

// Languages whose short function words must stick to the next word so they
// never hang at the end of a line. Add a new entry to support another language.
// Russian: "висячий предлог" is a typographic error in Russian publishing.
// See issue #4769.
const NBSP_LANGUAGES: Record<string, NbspLanguageConfig> = {
  ru: {
    script: 'Cyrillic',
    shortWords: [
      // prepositions
      'без',
      'для',
      'близ',
      'под',
      'над',
      'про',
      'при',
      'ради',
      'сквозь',
      'среди',
      'через',
      'около',
      'перед',
      'после',
      'между',
      'кроме',
      'вокруг',
      'против',
      'вместо',
      'внутри',
      'возле',
      // conjunctions
      'или',
      'либо',
      'ибо',
      'если',
      'едва',
      'дабы',
      'чтобы',
      'чтоб',
      'хотя',
      'пока',
      'зато',
      'тоже',
      'также',
      'итак',
      'как',
      'что',
      'чем',
      'так',
      // particles
      'даже',
      'лишь',
      'ведь',
      'вот',
      'вон',
      'уже',
      'хоть',
      'разве',
      'только',
      'именно',
      'неужели',
    ],
  },
};

// (boundary)(short word)(regular space)(?=script letter or digit) -> glue.
// `\b` is ASCII-only, so instead of a look-behind (disallowed in this repo) we
// capture and re-emit a non-letter boundary. Requiring a regular space then a
// letter/digit of the language's script ensures we never split a longer word.
const buildGlueRegex = ({ script, shortWords }: NbspLanguageConfig) =>
  new RegExp(
    `(^|[^\\p{L}])(${shortWords.join('|')}|\\p{Script=${script}}{1,2})` +
      `\\u0020(?=[\\p{Script=${script}}\\p{N}])`,
    'giu',
  );

const glueShortWords = (text: string, regex: RegExp): string => {
  if (!text.includes(' ')) return text;
  let result = text;
  let prev: string;
  // Loop until stable: a single pass cannot glue runs of consecutive short
  // words ("и в доме") because each match consumes the boundary it needs.
  do {
    prev = result;
    // Swap one regular space (U+0020) for one NBSP (U+00A0). Both are single
    // UTF-16 code units, so the text length is unchanged: DOM character offsets
    // and therefore CFIs stay valid for every word before and after this pass
    // (the following `proofread` transformer and stored annotations rely on it).
    result = result.replace(regex, '$1$2\u00A0');
  } while (result !== prev);
  return result;
};

// Match a whole <style>/<script> block (left untouched) or a run of text
// between two tags. Operating on the raw string keeps every tag, attribute,
// entity and the XML declaration byte-for-byte intact; only text nodes change.
const TEXT_OR_SKIP = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>|>([^<]+)</gi;

export const nbspTransformer: Transformer = {
  name: 'nbsp',

  transform: async (ctx) => {
    const config = NBSP_LANGUAGES[normalizedLangCode(ctx.primaryLanguage)];
    if (!config) return ctx.content;

    const regex = buildGlueRegex(config);
    return ctx.content.replace(TEXT_OR_SKIP, (match, _skipTag, text) =>
      text === undefined ? match : `>${glueShortWords(text, regex)}<`,
    );
  },
};
