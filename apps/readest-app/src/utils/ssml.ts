import { TTSMark } from '@/services/tts/types';

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

export const parseSSMLMarks = (ssml: string) => {
  const speakMatch = ssml.match(/<speak[^>]*xml:lang="([^"]+)"[^>]*>/i);
  const defaultLang = speakMatch?.[1] ?? 'en';
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
      if (text && activeMark) {
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

const inferLangFromScript = (text: string, lang: string | null): string | null => {
  if (!lang || lang.startsWith('en')) {
    if (/[\p{Script=Hangul}]/u.test(text)) {
      return 'ko';
    } else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
      return 'ja';
    } else if (/[\p{Script=Han}]/u.test(text)) {
      return 'zh';
    }
  }
  return lang;
};

export const parseSSMLLang = (ssml: string): string | null => {
  let lang = null;
  const match = ssml.match(/xml:lang\s*=\s*"([^"]+)"/);
  if (match && match[1]) {
    const parts = match[1].split('-');
    lang =
      parts.length > 1
        ? `${parts[0]!.toLowerCase()}-${parts[1]!.toUpperCase()}`
        : parts[0]!.toLowerCase();
  }
  return inferLangFromScript(ssml, lang);
};
