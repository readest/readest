/**
 * Utility functions for CJK (Chinese, Japanese, Korean) text processing
 */
import { cutZh, isJiebaReady } from '@/utils/jieba';

/**
 * Check if a character is a CJK character
 */
export function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
    (code >= 0x2a700 && code <= 0x2b73f) || // CJK Extension C
    (code >= 0x2b740 && code <= 0x2b81f) || // CJK Extension D
    (code >= 0x2b820 && code <= 0x2ceaf) || // CJK Extension E
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  );
}

/**
 * Check if text contains any CJK characters
 */
export function containsCJK(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text[i]!)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if text is CJK punctuation
 */
export function isCJKPunctuation(text: string): boolean {
  // Check if text is CJK punctuation (single character or string)
  // Includes: CJK symbols, full-width forms, and halfwidth variants
  const cjkPunctuationPattern =
    /[。！？，、；：""''（）《》【】『』「」〈〉〔〕〖〗〘〙〚〛…—～·․‥⋯﹐﹑﹒﹔﹕﹖﹗﹙﹚﹛﹜﹝﹞！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～｟｠｡｢｣､･\u3000-\u303F\uFF00-\uFFEF]/;
  return cjkPunctuationPattern.test(text);
}

/**
 * Detect the appropriate locale for text segmentation based on character ranges
 */
export function getSegmenterLocale(text: string): string | null {
  // Detect which CJK language based on character ranges
  for (const char of text) {
    const code = char.charCodeAt(0);

    // Japanese-specific characters
    if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) {
      return 'ja';
    }

    // Korean Hangul
    if (code >= 0xac00 && code <= 0xd7af) {
      return 'ko';
    }

    // Chinese characters (most common CJK range)
    if (code >= 0x4e00 && code <= 0x9fff) {
      return 'zh';
    }
  }

  return null;
}

/**
 * Segment CJK text into words using Intl.Segmenter with punctuation attachment.
 * If `language` starts with `zh` and jieba-wasm has been initialized
 * (see `initJieba` in @/utils/jieba), use it for higher-quality Chinese
 * segmentation.
 */
export function segmentCJKText(text: string, language?: string): string[] {
  if (language?.toLowerCase().startsWith('zh') && isJiebaReady()) {
    try {
      return segmentWithJieba(text);
    } catch (error) {
      console.warn('jieba-wasm failed, falling back to Intl.Segmenter:', error);
    }
  }

  // Try to use Intl.Segmenter for semantic word segmentation
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const locale = getSegmenterLocale(text) || 'zh';
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      const segments = Array.from(segmenter.segment(text));
      const words: string[] = [];
      let i = 0;

      while (i < segments.length) {
        const segment = segments[i]!;
        const segmentText = segment.segment;

        // Only process actual words (skip pure whitespace)
        if ((segment.isWordLike || containsCJK(segmentText)) && segmentText.trim()) {
          let wordWithPunct = segmentText;
          // Look ahead for trailing punctuation in the next segments
          let j = i + 1;
          while (j < segments.length) {
            const nextSegment = segments[j]!;
            const nextText = nextSegment.segment;

            // If next segment is whitespace, skip it but continue looking
            if (nextText.trim() === '') {
              j++;
              continue;
            }

            // If next segment is punctuation, attach it
            if (isCJKPunctuation(nextText)) {
              wordWithPunct += nextText;
              j++;
            } else {
              // Stop at the next word
              break;
            }
          }

          words.push(wordWithPunct);
          i = j; // Skip to after the punctuation we just processed
        } else {
          i++;
        }
      }

      return words;
    } catch (error) {
      console.warn('Intl.Segmenter failed, falling back to simple segmentation:', error);
    }
  }

  // Fallback: Simple character-based segmentation with punctuation
  const words: string[] = [];
  let currentWord = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (char.match(/\s/)) {
      if (currentWord) {
        words.push(currentWord);
        currentWord = '';
      }
    } else if (isCJK(char)) {
      currentWord += char;
      // Group 2 characters for readability
      if (currentWord.length >= 2) {
        // Look ahead for punctuation
        let j = i + 1;
        while (j < text.length && isCJKPunctuation(text[j]!)) {
          currentWord += text[j];
          i = j;
          j++;
        }
        words.push(currentWord);
        currentWord = '';
      }
    } else if (isCJKPunctuation(char)) {
      // Attach punctuation to current word
      currentWord += char;
    } else {
      currentWord += char;
    }
  }

  if (currentWord) {
    words.push(currentWord);
  }

  return words.filter((w) => w.trim().length > 0);
}

/**
 * Split a hyphenated word into display parts, keeping a trailing hyphen on
 * all but the last part. Only splits on hyphens that are directly between two
 * letters (letter-hyphen-letter), so tokens like "--", "-word", "word-", and
 * "foo--bar" are returned unchanged.
 *
 * Examples:
 *   "well-known"  → ["well-", "known"]
 *   "a-b-c"       → ["a-", "b-", "c"]
 *   "--"          → ["--"]
 *   "hello"       → ["hello"]
 */
export function getHyphenParts(word: string): string[] {
  if (!/[a-zA-Z](?:-|\.\.\.)[a-zA-Z]/.test(word)) return [word];
  // Capturing group preserves the delimiter in the split result array
  const parts = word.split(/([-]|\.\.\.)(?=[a-zA-Z])/);
  // parts = ["foo", "-", "bar", "...", "baz"] for "foo-bar...baz"
  const result: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i]!;
    const delimiter = parts[i + 1];
    result.push(delimiter ? segment + delimiter : segment);
  }
  return result;
}

/**
 * Segment Chinese text using jieba. Whitespace and standalone punctuation
 * runs are attached to the previous token so that downstream pause logic
 * still sees punctuation at word boundaries.
 */
function segmentWithJieba(text: string): string[] {
  const tokens = cutZh(text);
  const words: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    if (token.trim() === '') continue;
    if (isCJKPunctuation(token) && words.length > 0) {
      words[words.length - 1] = words[words.length - 1] + token;
      continue;
    }
    words.push(token);
  }
  return words;
}

/**
 * Split a token on em-dash (—) and en-dash (–), keeping the dash attached to
 * the preceding non-empty segment so downstream pause logic still sees it as
 * trailing punctuation. A leading dash with no preceding word is emitted as
 * its own token.
 *
 * Examples:
 *   "best—of"        → ["best—", "of"]
 *   "10–15"          → ["10–", "15"]
 *   "cliffhanger—"   → ["cliffhanger—"]
 *   "—continued"     → ["—", "continued"]
 */
function splitOnLongDashes(token: string): string[] {
  if (!/[–—]/.test(token)) return [token];
  const parts = token.split(/([–—])/);
  const result: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (/^[–—]$/.test(part) && result.length > 0) {
      result[result.length - 1] = result[result.length - 1] + part;
    } else {
      result.push(part);
    }
  }
  return result;
}

/**
 * Split text into words, handling both CJK and non-CJK text
 */
export function splitTextIntoWords(text: string, language?: string): string[] {
  const hasCJK = containsCJK(text);

  if (!hasCJK) {
    // Use space-based splitting for non-CJK text, then split on em/en-dashes so
    // compound phrases like "word—word" don't flash as a single unreadable run.
    return text
      .split(/(\s+)/)
      .filter((w) => w.trim().length > 0)
      .flatMap(splitOnLongDashes);
  }

  // For CJK text, use semantic segmentation
  const words: string[] = [];
  let currentSegment = '';
  let inCJKSequence = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const charIsCJK = isCJK(char);
    const charIsPunct = isCJKPunctuation(char);

    if (charIsCJK) {
      if (!inCJKSequence && currentSegment) {
        // Push non-CJK segment
        words.push(currentSegment);
        currentSegment = '';
      }
      currentSegment += char;
      inCJKSequence = true;
    } else if (charIsPunct) {
      // CJK punctuation should be kept with CJK segment
      if (inCJKSequence) {
        currentSegment += char;
        // Don't change inCJKSequence, keep collecting
      } else if (currentSegment) {
        // Non-CJK text followed by punctuation
        currentSegment += char;
      } else {
        // Standalone punctuation at start
        currentSegment = char;
      }
    } else if (char.match(/\s/)) {
      if (currentSegment) {
        if (inCJKSequence) {
          // Segment the CJK text (with any trailing punctuation)
          words.push(...segmentCJKText(currentSegment, language));
        } else {
          words.push(currentSegment);
        }
        currentSegment = '';
      }
      inCJKSequence = false;
    } else {
      // Non-CJK, non-punctuation, non-whitespace character
      if (inCJKSequence && currentSegment) {
        // Segment the CJK text before continuing with non-CJK
        words.push(...segmentCJKText(currentSegment, language));
        currentSegment = '';
      }
      currentSegment += char;
      inCJKSequence = false;
    }
  }

  if (currentSegment) {
    if (inCJKSequence) {
      words.push(...segmentCJKText(currentSegment, language));
    } else {
      words.push(currentSegment);
    }
  }

  return words.filter((w) => w.trim().length > 0);
}
