import { Allow, parse } from 'partial-json';

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
  const parsed = parseInlineInsightPayload(text);
  const originalBriefItems = normalizeInlineInsightItems(parsed?.brief);
  const originalDetailItems = normalizeInlineInsightItems(parsed?.details);
  const briefLabels = new Set(originalBriefItems.map((item) => item.label));
  const matchedDetailItems = originalDetailItems.filter((item) => briefLabels.has(item.label));
  const displayBriefItems = [
    ...originalBriefItems,
    // Small models sometimes keep the detail item but drift on the brief label. Show those
    // orphaned details in the brief list as well so the popup still surfaces the answer.
    ...originalDetailItems.filter((item) => !briefLabels.has(item.label)),
  ];

  return {
    briefItems: displayBriefItems,
    detailItems: matchedDetailItems,
    detailMap: Object.fromEntries(matchedDetailItems.map((item) => [item.label, item.content])),
  };
}

interface InlineInsightPayload {
  brief?: unknown;
  details?: unknown;
}

function parseInlineInsightPayload(text: string): InlineInsightPayload | null {
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) return null;

  try {
    return parse(text.slice(jsonStart), Allow.STR | Allow.OBJ | Allow.ARR) as InlineInsightPayload;
  } catch {
    return null;
  }
}

function normalizeInlineInsightItems(value: unknown): InlineInsightItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object') return [];

    const label =
      typeof (item as { label?: unknown }).label === 'string'
        ? (item as { label: string }).label.trim()
        : '';
    const content =
      typeof (item as { content?: unknown }).content === 'string'
        ? (item as { content: string }).content.trim()
        : '';
    if (!label || !content) return [];

    return [{ label, content }];
  });
}
