import { beforeEach, describe, expect, it } from 'vitest';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createSelectionAnchor,
  generateStubAnswer,
  validateCitation,
} from '@/services/foundation/sourceDocSpike';

describe('SOURCE_DOC foundation spike', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides the fixed two-section, twelve-block fixture', () => {
    expect(SOURCE_DOC_FIXTURE.sections).toHaveLength(2);
    expect(SOURCE_DOC_FIXTURE.blocks).toHaveLength(12);
    expect(new Set(SOURCE_DOC_FIXTURE.blocks.map((block) => block.id)).size).toBe(12);
    expect(SOURCE_DOC_FIXTURE.blocks.every((block) => block.renderSelector === block.id)).toBe(
      true,
    );
  });

  it('captures an exact selection with stable quote context', () => {
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const exactQuote = '紧致性把局部信息提升为全局控制';
    const startOffset = block.semanticText.indexOf(exactQuote);
    const anchor = createSelectionAnchor(block, startOffset, startOffset + exactQuote.length);

    expect(anchor).toMatchObject({
      blockId: block.id,
      sectionId: block.sectionId,
      exactQuote,
      startOffset,
      endOffset: startOffset + exactQuote.length,
    });
    expect(anchor.prefix.length).toBeGreaterThan(0);
    expect(anchor.suffix.length).toBeGreaterThan(0);
  });

  it('returns two valid citations from different blocks', () => {
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const startOffset = block.semanticText.indexOf('紧致性');
    const anchor = createSelectionAnchor(block, startOffset, startOffset + '紧致性'.length);
    const answer = generateStubAnswer(SOURCE_DOC_FIXTURE, anchor, '为什么需要紧致性？');

    expect(answer.citations).toHaveLength(2);
    expect(new Set(answer.citations.map((citation) => citation.blockId)).size).toBe(2);
    expect(
      answer.citations.every((citation) => validateCitation(SOURCE_DOC_FIXTURE, citation)),
    ).toBe(true);
  });

  it('persists and restores a complete thread', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const startOffset = block.semanticText.indexOf('紧致性');
    const anchor = createSelectionAnchor(block, startOffset, startOffset + '紧致性'.length);
    const thread = store.ask(SOURCE_DOC_FIXTURE, anchor, '为什么需要紧致性？');

    const restored = new SourceDocSpikeStore(localStorage).load();

    expect(restored?.id).toBe(thread.id);
    expect(restored?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(restored?.messages[1]?.citations).toHaveLength(2);
    expect(restored?.anchor).toEqual(anchor);
  });

  it('keeps consecutive questions in the same annotation thread', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const startOffset = block.semanticText.indexOf('紧致性');
    const anchor = createSelectionAnchor(block, startOffset, startOffset + '紧致性'.length);
    const first = store.ask(SOURCE_DOC_FIXTURE, anchor, '为什么需要紧致性？');
    const second = store.ask(SOURCE_DOC_FIXTURE, anchor, '这个结论如何用于证明？');

    expect(second.id).toBe(first.id);
    expect(second.messages).toHaveLength(4);
  });
});
