type TTSMark = {
  offset: number;
  name: string;
  text: string;
};

export const parseSSMLMarks = (ssml: string) => {
  ssml = ssml.replace(/<speak[^>]*>/i, '');
  ssml = ssml.replace(/<\/speak>/i, '');

  const markRegex = /<mark\s+name="([^"]+)"\s*\/>/g;
  let plainText = '';
  const marks: TTSMark[] = [];

  let match;
  while ((match = markRegex.exec(ssml)) !== null) {
    const markTagEndIndex = markRegex.lastIndex;
    const nextMarkIndex = ssml.indexOf('<mark', markTagEndIndex);
    const nextChunk = ssml.slice(
      markTagEndIndex,
      nextMarkIndex !== -1 ? nextMarkIndex : ssml.length,
    );
    const cleanedChunk = nextChunk
      .replace(/<[^>]+>/g, '')
      .replace(/\r\n/g, '  ')
      .replace(/\r/g, ' ')
      .replace(/\n/g, ' ')
      .trimStart();
    plainText += cleanedChunk;

    const offset = plainText.length - cleanedChunk.length;
    const markName = match[1]!;
    marks.push({ offset, name: markName, text: cleanedChunk });
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

export const parseSSMLLang = (ssml: string): string | null => {
  const match = ssml.match(/xml:lang\s*=\s*"([^"]+)"/);
  if (/[\p{Script=Han}]/u.test(ssml)) {
    return 'zh';
  } else if (match && match[1]) {
    const parts = match[1].split('-');
    return parts.length > 1
      ? `${parts[0]!.toLowerCase()}-${parts[1]!.toUpperCase()}`
      : parts[0]!.toLowerCase();
  }
  return null;
};
