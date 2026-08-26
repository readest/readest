import type { TextSelection } from '@/utils/sel';

export interface ContextTranslationContext {
  beforeContext: string;
  afterContext: string;
  sentence?: string;
  paragraph?: string;
}

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const nearestBefore = (text: string, maxLength: number): string => {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= maxLength ? normalized : normalized.slice(-maxLength).trimStart();
};

const nearestAfter = (text: string, maxLength: number): string => {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trimEnd();
};

const getRangeTextBefore = (range: Range): string => {
  const root = range.commonAncestorContainer;
  const scope = root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode;
  if (!scope) return '';
  const before = range.cloneRange();
  before.selectNodeContents(scope);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString();
};

const getRangeTextAfter = (range: Range): string => {
  const root = range.commonAncestorContainer;
  const scope = root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode;
  if (!scope) return '';
  const after = range.cloneRange();
  after.selectNodeContents(scope);
  after.setStart(range.endContainer, range.endOffset);
  return after.toString();
};

const getParagraph = (range: Range): string | undefined => {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const paragraph = element?.closest('p, li, blockquote, div');
  return paragraph?.textContent ? normalizeWhitespace(paragraph.textContent) : undefined;
};

const getSentence = (paragraph: string | undefined, selectedText: string): string | undefined => {
  if (!paragraph) return undefined;
  const selectedIndex = paragraph.indexOf(normalizeWhitespace(selectedText));
  if (selectedIndex < 0) return undefined;

  const before = paragraph.slice(0, selectedIndex);
  const after = paragraph.slice(selectedIndex + selectedText.length);
  const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const afterStops = [after.indexOf('.'), after.indexOf('!'), after.indexOf('?')].filter(
    (index) => index >= 0,
  );
  const sentenceEnd = afterStops.length > 0 ? Math.min(...afterStops) : -1;
  const start = sentenceStart >= 0 ? sentenceStart + 1 : 0;
  const end = sentenceEnd >= 0 ? selectedIndex + selectedText.length + sentenceEnd + 1 : paragraph.length;
  return paragraph.slice(start, end).trim();
};

export const buildContextTranslationContext = (
  selection: Pick<TextSelection, 'text' | 'range'>,
  maxContextChars: number,
): ContextTranslationContext => {
  const selectedText = normalizeWhitespace(selection.text);
  const budget = Math.max(0, maxContextChars - selectedText.length);
  const fullBeforeContext = normalizeWhitespace(getRangeTextBefore(selection.range));
  const fullAfterContext = normalizeWhitespace(getRangeTextAfter(selection.range));
  let beforeBudget = Math.floor(budget / 2);
  let afterBudget = budget - beforeBudget;
  if (fullBeforeContext.length < beforeBudget) {
    afterBudget += beforeBudget - fullBeforeContext.length;
  }
  if (fullAfterContext.length < afterBudget) {
    beforeBudget += afterBudget - fullAfterContext.length;
  }
  const beforeContext = nearestBefore(fullBeforeContext, beforeBudget);
  const afterContext = nearestAfter(fullAfterContext, afterBudget);
  const paragraph = getParagraph(selection.range);

  return {
    beforeContext,
    afterContext,
    sentence: getSentence(paragraph, selectedText),
    paragraph: paragraph && paragraph.length <= maxContextChars ? paragraph : undefined,
  };
};
