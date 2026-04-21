import { INLINE_INSIGHT_SEPARATOR } from './client';

export interface InlineInsightItem {
  label: string;
  content: string;
}

export interface ParsedInlineInsightSections {
  briefItems: InlineInsightItem[];
  detailItems: InlineInsightItem[];
  detailMap: Record<string, string>;
}

export function parseInlineInsightSections(text: string): ParsedInlineInsightSections {
  const separatorIndex = text.indexOf(INLINE_INSIGHT_SEPARATOR);
  const briefRaw = separatorIndex >= 0 ? text.slice(0, separatorIndex) : text;
  const detailRaw =
    separatorIndex >= 0 ? text.slice(separatorIndex + INLINE_INSIGHT_SEPARATOR.length) : '';
  const briefItems = parseInlineInsightItems(briefRaw);
  const detailItems = parseInlineInsightItems(detailRaw);

  return {
    briefItems,
    detailItems,
    // Details are keyed by label because the prompt guarantees the same ordering and tag set
    // across the brief and detailed sections.
    detailMap: Object.fromEntries(detailItems.map((item) => [item.label, item.content])),
  };
}

function parseInlineInsightItems(text: string): InlineInsightItem[] {
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^\[([^\]]+)\]\s+(.+)/);
      if (!match) return [];

      const item = { label: match[1]!, content: match[2]! };

      // Workaround: Models can repeat the same line while streaming. Deduplicate here so the popup
      // remains stable even if the transport emits overlapping chunks.
      const key = `${item.label}\n${item.content}`;
      if (seen.has(key)) return [];
      seen.add(key);

      return [item];
    });
}
