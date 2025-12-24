import * as CFI from 'foliate-js/epubcfi.js';
import type { Transformer } from './types';
import { ProofreadRule } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';

interface NormalizedPattern {
  source: string;
  flags: string;
}

const isUnicodeWordChar = (char: string): boolean => /[\p{L}\p{N}_]/u.test(char || '');
const hasUnicodeChars = (text: string): boolean => /[^\x00-\x7F]/.test(text);

function normalizePattern(
  pattern: string,
  isRegex: boolean,
  caseSensitive = true,
): NormalizedPattern {
  const hasUnicode = hasUnicodeChars(pattern);

  let flags = hasUnicode ? 'ug' : 'g';
  if (!caseSensitive) flags += 'i';

  if (isRegex) {
    const source = pattern.includes('\\b') || hasUnicode ? pattern : `\\b${pattern}\\b`;
    return { source, flags };
  }

  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (hasUnicode) {
    return { source: escaped, flags };
  }

  const startsWithPunctuation = /^[^\w\s]/.test(pattern);
  const endsWithPunctuation = /[^\w\s]$/.test(pattern);

  if (startsWithPunctuation || endsWithPunctuation) {
    const wordMatch = pattern.match(/[\w]+/);
    if (!wordMatch) return { source: escaped, flags };

    const wordPart = wordMatch[0];
    const wordStart = pattern.indexOf(wordPart);
    const wordEnd = wordStart + wordPart.length;
    const wordEscaped = wordPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const beforeWord = escaped.substring(0, wordStart);
    const afterWord = escaped.substring(wordEnd);
    return { source: `${beforeWord}\\b${wordEscaped}\\b${afterWord}`, flags };
  }

  return { source: `\\b${escaped}\\b`, flags };
}

function isValidMatch(text: string, match: RegExpExecArray, rule: ProofreadRule): boolean {
  if (!rule.isRegex) {
    const isCaseSensitive = rule.caseSensitive !== false;
    const isExactMatch = isCaseSensitive
      ? match[0] === rule.pattern
      : match[0].toLowerCase() === rule.pattern.toLowerCase();
    if (!isExactMatch) return false;
  }

  if (hasUnicodeChars(rule.pattern)) {
    const charBefore = text[match.index - 1] ?? '';
    const charAfter = text[match.index + match[0].length] ?? '';
    if (isUnicodeWordChar(charBefore) || isUnicodeWordChar(charAfter)) {
      return false;
    }
  }

  return true;
}

function applyReplacementMulti(
  textNodes: Text[],
  rule: ProofreadRule & { normalizedPattern: NormalizedPattern },
): void {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.normalizedPattern.source, rule.normalizedPattern.flags);
  } catch {
    return;
  }

  for (const textNode of textNodes) {
    if (!textNode.textContent) continue;

    let text = textNode.textContent;
    const matches: Array<{ index: number; length: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (!isValidMatch(text, match, rule)) continue;
      matches.push({ index: match.index, length: match[0].length });
    }

    if (matches.length === 0) continue;

    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]!;
      text = text.slice(0, m.index) + rule.replacement + text.slice(m.index + m.length);
    }

    textNode.textContent = text;
  }
}

function applyReplacementSingle(
  doc: Document,
  rule: ProofreadRule & { normalizedPattern: NormalizedPattern },
): void {
  let regex: RegExp;
  try {
    regex = new RegExp(rule.normalizedPattern.source, rule.normalizedPattern.flags);
  } catch {
    return;
  }

  const parts = CFI.parse(rule.cfi);
  if (parts.parent) {
    parts.parent.shift();
    const range = CFI.toRange(doc, parts) as Range;
    if (range) {
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;
      if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
        const textNode = startContainer as Text;
        const text = textNode.textContent || '';
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;

        // Add 32-char tolerance buffer around the selection
        const bufferSize = 32;
        const bufferStart = Math.max(0, startOffset - bufferSize);
        const bufferEnd = Math.min(text.length, endOffset + bufferSize);

        const bufferedText = text.slice(bufferStart, bufferEnd);
        const selectedText = text.slice(startOffset, endOffset);

        const match = regex.exec(bufferedText);
        if (match && isValidMatch(selectedText, match, rule)) {
          const matchStartInBuffer = match.index;
          const matchStartInText = bufferStart + matchStartInBuffer;
          const matchEnd = matchStartInText + match[0].length;

          if (matchEnd >= startOffset - bufferSize && matchStartInText <= endOffset + bufferSize) {
            const newText =
              text.slice(0, matchStartInText) + rule.replacement + text.slice(matchEnd);
            textNode.textContent = newText;
            return;
          }
        }
      }
    }
  }
}

function getTextNodes(doc: Document): Text[] {
  const walker = document.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent?.tagName === 'SCRIPT' || parent?.tagName === 'STYLE') {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }
  return textNodes;
}

export const proofreadTransformer: Transformer = {
  name: 'proofread',

  transform: async (ctx) => {
    const globalRules = useSettingsStore.getState().settings?.globalViewSettings?.proofreadRules;
    const bookRules = ctx.viewSettings.proofreadRules;
    const merged = [...(globalRules ?? []), ...(bookRules ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    if (!merged.length) return ctx.content;

    const processed = merged
      .filter((r) => r.enabled && r.pattern.trim())
      .map((r) => ({
        ...r,
        normalizedPattern: normalizePattern(r.pattern, r.isRegex, r.caseSensitive !== false),
      }));

    if (!processed.length) return ctx.content;

    const parser = new DOMParser();
    const doc = parser.parseFromString(ctx.content, 'text/html');
    const textNodes = getTextNodes(doc);

    const byScope = {
      selection: processed.filter((r) => r.scope === 'selection'),
      book: processed.filter((r) => r.scope === 'book'),
      library: processed.filter((r) => r.scope === 'library'),
    };

    const ordered = [...byScope.selection, ...byScope.book, ...byScope.library];

    for (const rule of ordered) {
      if (rule.scope === 'selection') {
        const ruleBase = rule.sectionHref?.split('#')[0];
        const ctxBase = ctx.sectionHref?.split('#')[0];
        if (ctxBase !== ruleBase) continue;
      }
      if (rule.scope === 'selection') {
        applyReplacementSingle(doc, rule);
      } else {
        applyReplacementMulti(textNodes, rule);
      }
    }

    return new XMLSerializer().serializeToString(doc);
  },
};
