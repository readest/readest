// Helper to check if selected text is a whole word (has word boundaries on both sides)
// Note: Word boundary checks only apply to space-separated languages (English, etc.)
// CJK languages (Chinese, Japanese, Korean) don't require boundary checks
export const isWholeWord = (range: Range, selectedText: string): boolean => {
  try {
    const trimmed = selectedText.trim();
    if (!trimmed) return false;

    // Unicode-aware patterns
    const wordCharPattern = /[\p{L}\p{N}\p{M}_]/u;
    const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

    // Must contain at least one word character
    if (!wordCharPattern.test(trimmed)) return false;

    // CJK text doesn't need boundary checks (no spaces between words)
    if (cjkPattern.test(trimmed)) return true;

    // Phrases (with spaces/punctuation) are always valid
    if (/[\s\p{P}\p{S}]/u.test(trimmed)) return true;

    // For single words in space-separated languages, check boundaries
    const { charBefore, charAfter } = getBoundaryChars(range);
    const isWordChar = (char: string) => wordCharPattern.test(char);

    return (!charBefore || !isWordChar(charBefore)) && (!charAfter || !isWordChar(charAfter));
  } catch (e) {
    console.warn('Failed to check whole word:', e);
    return /[\p{L}\p{N}\p{M}_]/u.test(selectedText);
  }
};

export const isPunctuationOnly = (text: string): boolean => {
  const punctuationPattern = /^[\p{P}\p{S}\s]+$/u;
  return punctuationPattern.test(text);
};

// Helper to get characters before and after the selection
const getBoundaryChars = (range: Range): { charBefore: string; charAfter: string } => {
  let charBefore = '';
  let charAfter = '';

  try {
    // Get character before
    const startNode = range.startContainer;
    if (startNode.nodeType === Node.TEXT_NODE) {
      const textNode = startNode as Text;
      if (range.startOffset > 0) {
        charBefore = textNode.textContent?.charAt(range.startOffset - 1) || '';
      } else {
        // Check previous sibling
        let prev = startNode.previousSibling;
        while (prev && prev.nodeType !== Node.TEXT_NODE) {
          prev = prev.previousSibling;
        }
        if (prev?.nodeType === Node.TEXT_NODE) {
          const prevText = (prev as Text).textContent || '';
          charBefore = prevText.charAt(prevText.length - 1);
        }
      }
    }

    // Get character after
    const endNode = range.endContainer;
    if (endNode.nodeType === Node.TEXT_NODE) {
      const textNode = endNode as Text;
      const textContent = textNode.textContent || '';
      if (range.endOffset < textContent.length) {
        charAfter = textContent.charAt(range.endOffset);
      } else {
        // Check next sibling
        let next = textNode.nextSibling;
        while (next && next.nodeType !== Node.TEXT_NODE) {
          next = next.nextSibling;
        }
        if (next?.nodeType === Node.TEXT_NODE) {
          charAfter = ((next as Text).textContent || '').charAt(0);
        }
      }
    }
  } catch (e) {
    console.warn('[getBoundaryChars] Error:', e);
  }

  return { charBefore, charAfter };
};

export const getWordCount = (text: string): number => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};
