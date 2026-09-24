import { beforeEach, describe, expect, it } from 'vitest';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
  createSelectionAnchor,
  generateStubAnswer,
  parseMarkdownDocument,
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
    const second = store.ask(SOURCE_DOC_FIXTURE, anchor, '这个结论如何用于证明？', first.id);

    expect(second.id).toBe(first.id);
    expect(second.messages).toHaveLength(4);
  });

  it('persists an unanchored conversation and preserves an optional text attachment', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const thread = store.ask(
      SOURCE_DOC_FIXTURE,
      null,
      '没有选中文本也能提问吗？',
      undefined,
      '附加的原文',
    );

    expect(thread.unanchored).toBe(true);
    expect(thread.messages[0]?.attachment).toBe('附加的原文');
    expect(new SourceDocSpikeStore(localStorage).listThreads()[0]?.unanchored).toBe(true);
    expect(generateStubAnswer(SOURCE_DOC_FIXTURE, null, '无锚点')).toHaveProperty('citations');
  });

  it('imports real Markdown into stable sections and blocks', () => {
    const markdown = `# 第一章\n\n第一段有 **重点**。\n\n## 子节\n\n- 条目一\n- 条目二\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``;
    const first = parseMarkdownDocument('测试书.md', markdown);
    const second = parseMarkdownDocument('测试书.md', markdown);

    expect(first.title).toBe('第一章');
    expect(first.sections.map((section) => section.title)).toEqual(['第一章', '子节']);
    expect(first.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'code',
    ]);
    expect(first.blocks[1]?.semanticText).toBe('第一段有 重点。');
    expect(first.blocks[3]?.semanticText).toBe('条目一条目二');
    expect(first.blocks.map((block) => block.id)).toEqual(second.blocks.map((block) => block.id));
  });

  it('refreshes derived blocks when source preferences reparse the same version', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const imported = {
      ...SOURCE_DOC_FIXTURE,
      id: 'html-document',
      versionId: 'html-version',
      sourceFormat: 'html' as const,
      blocks: [
        {
          ...SOURCE_DOC_FIXTURE.blocks[0]!,
          id: 'article-block',
          renderSelector: 'article-block',
          semanticText: '正文模式',
          sourceText: '正文模式',
        },
      ],
    };
    store.importDocument(imported);
    store.importDocument({
      ...imported,
      blocks: [
        {
          ...imported.blocks[0]!,
          id: 'full-block',
          renderSelector: 'full-block',
          semanticText: '完整网页',
          sourceText: '完整网页',
        },
      ],
    });

    expect(store.loadCurrentDocument().blocks.map((block) => block.id)).toEqual(['full-block']);
  });

  it('keeps Markdown table anchor text aligned with its rendered cell order', () => {
    const document = parseMarkdownDocument(
      '表格.md',
      '# 表格\n\n| 条件 | 作用 |\n| --- | --- |\n| 紧致性 | 保证收敛子列 |',
    );
    const table = document.blocks.find((block) => block.type === 'table')!;

    expect(table.semanticText).toBe('条件作用紧致性保证收敛子列');
    const start = table.semanticText.indexOf('紧致性');
    expect(createSelectionAnchor(table, start, start + 3).exactQuote).toBe('紧致性');
  });

  it('migrates v4 Markdown offsets without losing existing annotations', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const imported = store.importMarkdown(
      '旧表格.md',
      '# 表格\n\n| 条件 | 作用 |\n| --- | --- |\n| 紧致性 | 保证收敛子列 |',
    );
    const table = imported.blocks.find((block) => block.type === 'table')!;
    const oldSemanticText = '条件 | 作用\n--- | ---\n紧致性 | 保证收敛子列';
    const oldTable = { ...table, semanticText: oldSemanticText };
    const oldStart = oldSemanticText.indexOf('紧致性');
    store.ask(
      {
        ...imported,
        blocks: imported.blocks.map((block) => (block.id === table.id ? oldTable : block)),
      },
      createSelectionAnchor(oldTable, oldStart, oldStart + 3),
      '旧批注',
    );
    const oldSchema = store.loadSchema();
    oldSchema.documentVersions.find((version) => version.id === imported.versionId)!.parserVersion =
      'markdown-alpha-1';
    oldSchema.blocks.find((block) => block.id === table.id)!.semanticText = oldSemanticText;
    localStorage.setItem('readest:annotation-schema:v1', JSON.stringify(oldSchema));

    const migratedStore = new SourceDocSpikeStore(localStorage);
    const migratedTable = migratedStore
      .loadCurrentDocument()
      .blocks.find((block) => block.id === table.id)!;
    const migratedThread = migratedStore.load()!;

    expect(migratedTable.semanticText).toBe('条件作用紧致性保证收敛子列');
    expect(migratedThread.anchor.exactQuote).toBe('紧致性');
    expect(migratedThread.anchor.startOffset).toBe(migratedTable.semanticText.indexOf('紧致性'));
  });

  it('persists schema v1 and migrates the legacy spike thread', () => {
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const anchor = createSelectionAnchor(block, 0, 3);
    localStorage.setItem(
      'readest:foundation-spike:v1',
      JSON.stringify({
        id: 'legacy-thread',
        anchor,
        messages: [{ id: 'legacy-message', role: 'user', content: '旧问题', citations: [] }],
      }),
    );

    const store = new SourceDocSpikeStore(localStorage);
    const schema = store.loadSchema();

    expect(schema.schemaVersion).toBe(1);
    expect(schema.documents).toHaveLength(1);
    expect(schema.documentVersions).toHaveLength(1);
    expect(schema.sections).toHaveLength(2);
    expect(schema.blocks).toHaveLength(12);
    expect(schema.anchors).toHaveLength(1);
    expect(schema.threads[0]?.id).toBe('legacy-thread');
    expect(schema.messages[0]?.content).toBe('旧问题');
    expect(localStorage.getItem('readest:annotation-schema:v1')).not.toBeNull();
  });

  it('uses one authoritative store for multiple threads on the same anchor', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const anchor = createSelectionAnchor(block, 0, 3);
    const first = store.ask(SOURCE_DOC_FIXTURE, anchor, '问题一');
    const second = store.ask(SOURCE_DOC_FIXTURE, anchor, '问题二');

    expect(second.id).not.toBe(first.id);
    expect(store.listThreads()).toHaveLength(2);
    expect(store.listThreadGroups()[0]).toMatchObject({ blockId: block.id, count: 2 });
  });

  it('supports title, message, archive, and delete management', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const anchor = createSelectionAnchor(block, 0, 3);
    const thread = store.ask(SOURCE_DOC_FIXTURE, anchor, '原问题');
    const userMessage = thread.messages[0]!;

    store.renameThread(thread.id, '新的标题');
    store.editMessage(userMessage.id, '修改后的问题');
    store.setThreadArchived(thread.id, true);
    expect(store.getThread(thread.id)).toMatchObject({
      title: '新的标题',
      status: 'archived',
    });
    expect(store.getThread(thread.id)?.messages[0]?.content).toBe('修改后的问题');

    store.deleteThread(thread.id);
    expect(store.getThread(thread.id)).toBeNull();
    expect(store.loadSchema().messages).toHaveLength(0);
    expect(store.loadSchema().citations).toHaveLength(0);
  });

  it('deletes multiple annotation threads atomically', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const firstBlock = SOURCE_DOC_FIXTURE.blocks[1]!;
    const secondBlock = SOURCE_DOC_FIXTURE.blocks[2]!;
    const first = store.ask(SOURCE_DOC_FIXTURE, createSelectionAnchor(firstBlock, 0, 3), '第一条');
    const second = store.ask(
      SOURCE_DOC_FIXTURE,
      createSelectionAnchor(secondBlock, 0, 3),
      '第二条',
    );

    store.deleteThreads([first.id, second.id]);

    expect(store.listThreads()).toHaveLength(0);
    expect(store.loadSchema().messages).toHaveLength(0);
    expect(store.loadSchema().citations).toHaveLength(0);
  });

  it('retains other-document annotations without listing them in the current document', () => {
    const store = new SourceDocSpikeStore(localStorage);
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const thread = store.ask(SOURCE_DOC_FIXTURE, createSelectionAnchor(block, 0, 3), '保留我');

    const imported = store.importMarkdown('新书.md', '# 新书\n\n真实正文。');

    expect(imported.blocks).toHaveLength(2);
    expect(store.getThread(thread.id)).toBeNull();
    expect(
      store.loadSchema().messages.find((message) => message.threadId === thread.id)?.content,
    ).toBe('保留我');
    expect(new SourceDocSpikeStore(localStorage).loadCurrentDocument().title).toBe('新书');
  });

  it('isolates annotation schemas for different native library books', () => {
    const firstStore = new SourceDocSpikeStore(localStorage, 'library:first');
    const secondStore = new SourceDocSpikeStore(localStorage, 'library:second');
    const firstDocument = firstStore.importMarkdown(
      '同名书.md',
      '# 第一册\n\n第一册正文。',
      'book-first',
    );
    const secondDocument = secondStore.importMarkdown(
      '同名书.md',
      '# 第二册\n\n第二册正文。',
      'book-second',
    );

    firstStore.ask(
      firstDocument,
      createSelectionAnchor(firstDocument.blocks[1]!, 0, 3),
      '第一册问题',
    );
    secondStore.ask(
      secondDocument,
      createSelectionAnchor(secondDocument.blocks[1]!, 0, 3),
      '第二册问题',
    );

    expect(new SourceDocSpikeStore(localStorage, 'library:first').listThreads()[0]?.title).toBe(
      '第一册问题',
    );
    expect(new SourceDocSpikeStore(localStorage, 'library:second').listThreads()[0]?.title).toBe(
      '第二册问题',
    );
    expect(localStorage.getItem('readest:annotation-schema:v1:library:first')).not.toBeNull();
    expect(localStorage.getItem('readest:annotation-schema:v1:library:second')).not.toBeNull();
  });

  it('recovers from corrupt or unavailable storage', () => {
    localStorage.setItem('readest:annotation-schema:v1', '{not-json');
    expect(new SourceDocSpikeStore(localStorage).loadCurrentDocument().title).toBe(
      SOURCE_DOC_FIXTURE.title,
    );

    const unavailableStorage: Storage = {
      length: 0,
      clear: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
      key: () => null,
      removeItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const unavailableStore = new SourceDocSpikeStore(unavailableStorage);
    expect(unavailableStore.loadCurrentDocument().title).toBe(SOURCE_DOC_FIXTURE.title);
    expect(() => unavailableStore.clear()).not.toThrow();
  });

  it('selects replies only from the fixed local candidate set', () => {
    const block = SOURCE_DOC_FIXTURE.blocks[1]!;
    const anchor = createSelectionAnchor(block, 0, 3);
    const first = generateStubAnswer(SOURCE_DOC_FIXTURE, anchor, '问题', () => 0);
    const last = generateStubAnswer(SOURCE_DOC_FIXTURE, anchor, '问题', () => 0.9999);

    expect(first.content).not.toBe(last.content);
    expect(first.citations).toHaveLength(2);
    expect(last.citations).toHaveLength(2);
  });
});
