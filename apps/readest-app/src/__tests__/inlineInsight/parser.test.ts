import { describe, expect, it } from 'vitest';
import { parseInlineInsightSections } from '@/services/inlineInsight/parser';

describe('parseInlineInsightSections', () => {
  it('parses a complete JSON response', () => {
    const parsed = parseInlineInsightSections(
      '{"brief":[{"label":"Meaning","content":"A concise summary."}],"details":[{"label":"Meaning","content":"A longer explanation with more context."}]}',
    );

    expect(parsed.briefItems).toEqual([{ label: 'Meaning', content: 'A concise summary.' }]);
    expect(parsed.detailMap).toEqual({
      Meaning: 'A longer explanation with more context.',
    });
  });

  it('parses partial JSON while the brief content string is still growing', () => {
    const parsed = parseInlineInsightSections(
      '{"brief":[{"label":"Meaning","content":"A concise summ',
    );

    expect(parsed.briefItems).toEqual([{ label: 'Meaning', content: 'A concise summ' }]);
    expect(parsed.detailItems).toEqual([]);
  });

  it('parses partial JSON while the detail content string is still growing', () => {
    const parsed = parseInlineInsightSections(
      '{"brief":[{"label":"Meaning","content":"A concise summary."}],"details":[{"label":"Meaning","content":"A longer expl',
    );

    expect(parsed.briefItems).toEqual([{ label: 'Meaning', content: 'A concise summary.' }]);
    expect(parsed.detailMap).toEqual({
      Meaning: 'A longer expl',
    });
  });

  it('shows unmatched detail items in the brief list', () => {
    const parsed = parseInlineInsightSections(
      '{"brief":[{"label":"Meaning","content":"A concise summary."}],"details":[{"label":"Background","content":"A longer explanation with more context."}]}',
    );

    expect(parsed.briefItems).toEqual([
      { label: 'Meaning', content: 'A concise summary.' },
      { label: 'Background', content: 'A longer explanation with more context.' },
    ]);
    expect(parsed.detailItems).toEqual([]);
    expect(parsed.detailMap).toEqual({});
  });

  it('deduplicates repeated items produced during streaming', () => {
    const parsed = parseInlineInsightSections(
      '{"brief":[{"label":"Meaning","content":"A concise summary."},{"label":"Meaning","content":"A concise summary."}],"details":[{"label":"Meaning","content":"A longer explanation."},{"label":"Meaning","content":"A longer explanation."}]}',
    );

    expect(parsed.briefItems).toEqual([{ label: 'Meaning', content: 'A concise summary.' }]);
    expect(parsed.detailItems).toEqual([{ label: 'Meaning', content: 'A longer explanation.' }]);
    expect(parsed.detailMap).toEqual({
      Meaning: 'A longer explanation.',
    });
  });
});
