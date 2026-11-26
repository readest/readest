import { TTSMark } from '@/services/tts/types';
import { code6392to6391, inferLangFromScript, isSameLang, isValidLang } from './lang';

const cleanTextContent = (text: string) =>
  text.replace(/\r\n/g, '  ').replace(/\r/g, ' ').replace(/\n/g, ' ').trimStart();

export const genSSML = (lang: string, text: string, voice: string, rate: number) => {
  const cleanedText = text.replace(/^<break\b[^>]*>/i, '');
  return `
    <speak version="1.0" xml:lang="${lang}">
      <voice name="${voice}">
        <prosody rate="${rate}" >
            ${cleanedText}
        </prosody>
      </voice>
    </speak>
  `;
};

export const genSSMLRaw = (text: string) => {
  return `
    <speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en"><mark name="-1"/>${text}</speak>
  `;
};

function* getLanguageBlocks(ssml: string) {
  let depth = 0;
  let start = 0;
  let openEnd = 0;
  let lang = '';
  for (const match of ssml.matchAll(/<lang\s+xml:lang="([^"]+)"[^>]*>|<\/lang>/g)) {
    const tag = match[0];
    const index = match.index!;
    if (match[1]) {
      if (tag.endsWith('/>')) continue;
      if (depth === 0) {
        start = index;
        openEnd = index + tag.length;
        lang = match[1];
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        yield { start, end: index + tag.length, lang, content: ssml.slice(openEnd, index) };
      }
    }
  }
}

const removeLanguageBlocks = (ssml: string, keep: (lang: string) => boolean) => {
  let result = '';
  let from = 0;
  for (const { start, end, lang } of getLanguageBlocks(ssml)) {
    if (keep(lang)) continue;
    result += ssml.slice(from, start);
    from = end;
  }
  return result + ssml.slice(from);
};

export const parseSSMLLang = (ssml: string, primaryLang?: string): string => {
  let lang = 'en';
  const match = ssml.match(/xml:lang\s*=\s*"([^"]+)"/);
  if (match && match[1]) {
    const parts = match[1].split('-');
    lang =
      parts.length > 1
        ? `${parts[0]!.toLowerCase()}-${parts[1]!.toUpperCase()}`
        : parts[0]!.toLowerCase();

    lang = code6392to6391(lang) || lang;
    if (!isValidLang(lang)) {
      lang = 'en';
    }
  }
  primaryLang = code6392to6391(primaryLang?.toLowerCase() || '') || primaryLang;
  // `en` is what we fall back to when nothing declared a language, and it is
  // also what authoring tools stamp on their own: Word leaves `<body
  // lang="EN-US">` on every converted EPUB. foliate reads the nearest ancestor
  // with a lang, so that body beats the book's own `<html lang="vi">` and the
  // whole book gets read by an English voice. Treat the regional variants the
  // same way as bare `en` and let the book's declared language win.
  const isDefaultEnglish = lang.split('-')[0] === 'en';
  if (isDefaultEnglish && primaryLang && !isSameLang(lang, primaryLang)) {
    lang = primaryLang.split('-')[0]!.toLowerCase();
  }
  const textWithoutLangTags = removeLanguageBlocks(ssml, () => false);
  return inferLangFromScript(textWithoutLangTags, lang);
};

const isValidMark = (mark: string) => {
  const trimmed = mark.trim();
  if (!trimmed || trimmed.length === 0) {
    return false;
  }
  if (/^[\p{P}\p{S}]+$/u.test(trimmed)) {
    return false;
  }
  return true;
};

export const parseSSMLMarks = (ssml: string, primaryLang?: string) => {
  const defaultLang = parseSSMLLang(ssml, primaryLang) || 'en';
  ssml = ssml.replace(/<speak[^>]*>/i, '').replace(/<\/speak>/i, '');

  let plainText = '';
  const marks: TTSMark[] = [];

  let activeMark: string | null = null;
  let currentLang = defaultLang;
  const langStack: string[] = [];

  const tagRegex = /<(\/?)(\w+)([^>]*)>|([^<]+)/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(ssml)) !== null) {
    if (match[4]) {
      const rawText = match[4];
      const text = cleanTextContent(rawText);
      if (text && activeMark && isValidMark(text)) {
        const offset = plainText.length;
        plainText += text;
        marks.push({
          offset,
          name: activeMark,
          text,
          language: inferLangFromScript(text, currentLang) || currentLang,
        });
      } else {
        plainText += cleanTextContent(rawText);
      }
    } else {
      const isEnd = match[1] === '/';
      const tagName = match[2];
      const attr = match[3];

      if (tagName === 'mark' && !isEnd) {
        const nameMatch = attr?.match(/name="([^"]+)"/);
        if (nameMatch) {
          activeMark = nameMatch[1]!;
        }
      } else if (tagName === 'lang') {
        if (!isEnd) {
          langStack.push(currentLang);
          const langMatch = attr?.match(/xml:lang="([^"]+)"/);
          if (langMatch) {
            currentLang = langMatch[1]!;
          }
        } else {
          currentLang = langStack.pop() ?? defaultLang;
        }
      }
    }
  }

  return { plainText, marks };
};

// Cut an utterance down to the sentence at `markName`: everything from the
// next <mark> on is dropped, so the engine ends where that sentence ends.
export const truncateSSMLAfterMark = (ssml: string, markName: string): string => {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return ssml;
  const marks = Array.from(doc.getElementsByTagName('mark'));
  const index = marks.findIndex((mark) => mark.getAttribute('name') === markName);
  const cut = index >= 0 ? marks[index + 1] : undefined;
  if (!cut) return ssml;
  let node: Node = cut;
  while (node.parentNode && node !== doc.documentElement) {
    while (node.nextSibling) node.parentNode.removeChild(node.nextSibling);
    node = node.parentNode;
  }
  cut.remove();
  return new XMLSerializer().serializeToString(doc);
};

export const findSSMLMark = (charIndex: number, marks: TTSMark[]) => {
  let left = 0;
  let right = marks.length - 1;
  let result: TTSMark | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const mark = marks[mid]!;

    if (mark.offset <= charIndex) {
      result = mark;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

export const filterSSMLWithLang = (
  ssml: string,
  targetLang: string,
  primaryLang?: string,
): string => {
  const mainLang = parseSSMLLang(ssml, primaryLang);

  // Normalize target language
  const normalizedTarget = code6392to6391(targetLang.toLowerCase()) || targetLang.toLowerCase();

  const matchesTarget = (lang: string) =>
    isSameLang(code6392to6391(lang.toLowerCase()) || lang.toLowerCase(), normalizedTarget);

  if (isSameLang(normalizedTarget, mainLang)) {
    return removeLanguageBlocks(ssml, matchesTarget);
  }

  // An inline foreign phrase can introduce a nested <lang> tag inside a
  // translation. Keep the full outer block and its original marks together.
  const langBlocks = [...getLanguageBlocks(ssml)].filter((block) => matchesTarget(block.lang));

  if (langBlocks.length > 0) {
    const speakOpenMatch = ssml.match(/<speak[^>]*>/i);
    const speakCloseMatch = ssml.match(/<\/speak>/i);

    if (!speakOpenMatch || !speakCloseMatch) {
      return ssml;
    }

    const combinedContent = langBlocks
      .map((block) => {
        const match = ssml.slice(block.start, block.end);
        const firstMarkIndex = block.content.search(/<mark\b[^>]*\/>/i);
        const textBeforeFirstMark = block.content
          .slice(0, firstMarkIndex < 0 ? undefined : firstMarkIndex)
          .replace(/<[^>]+>/g, '')
          .trim();
        if (!textBeforeFirstMark) return match;

        // Foliate can place the mark for the first translated sentence
        // immediately before its <lang> block. Keep that existing mark when
        // source text is filtered out, even when later translated sentences
        // already have marks of their own.
        const precedingMarks = ssml.slice(0, block.start).match(/<mark\b[^>]*\/>/gi);
        const precedingMark = precedingMarks?.at(-1);
        if (!precedingMark) return match;

        return match.replace(/(<lang\b[^>]*>)/i, `$1${precedingMark}`);
      })
      .join('');
    return `${speakOpenMatch[0]}${combinedContent}${speakCloseMatch[0]}`;
  }

  return ssml;
};
