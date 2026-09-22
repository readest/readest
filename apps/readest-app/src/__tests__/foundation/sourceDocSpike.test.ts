import { beforeEach, describe, expect, it } from 'vitest';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
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

  it('captures a continuous selection across source blocks', () => {
    const first = SOURCE_DOC_FIXTURE.blocks[1]!;
    const last = SOURCE_DOC_FIXTURE.blocks[2]!;
    const startOffset = first.semanticText.indexOf('紧致性');
    const endOffset = last.semanticText.indexOf('因此') + '因此'.length;
    const anchor = createRangeAnchor(SOURCE_DOC_FIXTURE, first.id, startOffset, last.id, endOffset);

    expect(anchor.selectedBlockIds).toEqual([first.id, last.id]);
    expect(anchor.endBlockId).toBe(last.id);
    expect(anchor.exactQuote).toContain('\n');
    expect(anchor.exactQuote).toContain('紧致性把局部信息提升为全局控制');
    expect(anchor.exactQuote).toContain('因此');
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

  it('upgrades anchors saved by the first spike build', () => {
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const anchor = createSelectionAnchor(block, 0, 3);
    const {
      endBlockId: _endBlockId,
      selectedBlockIds: _selectedBlockIds,
      ...legacyAnchor
    } = anchor;
    localStorage.setItem(
      'readest:foundation-spike:v1',
      JSON.stringify({ id: 'legacy', anchor: legacyAnchor, messages: [] }),
    );

    expect(new SourceDocSpikeStore(localStorage).load()?.anchor).toMatchObject({
      endBlockId: block.id,
      selectedBlockIds: [block.id],
    });
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
