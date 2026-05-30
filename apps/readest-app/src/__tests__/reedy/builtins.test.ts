import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '@/services/reedy/tools/ToolRegistry';
import type { ToolContext } from '@/services/reedy/tools/types';
import {
  createAddCitationTool,
  createCreateHighlightTool,
  createCreateNoteTool,
  createGetReadingContextTool,
  createGetSelectionTool,
  createLookupPassageTool,
  createNavigateToCfiTool,
  type ReadingContextSnapshot,
} from '@/services/reedy/tools/builtins';
import type { BookRetriever, RetrieverResult } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  const controller = new AbortController();
  return {
    bookHash: 'bk1',
    sessionId: 's1',
    assistantMessageId: 'm1',
    signal: controller.signal,
    requestPermission: vi.fn(async () => true),
    ...overrides,
  };
}

const readingSnapshot: ReadingContextSnapshot = {
  cfi: 'epubcfi(/6/4!/4/2,/1:0)',
  sectionIndex: 1,
  chapterTitle: 'Down the Rabbit Hole',
  pageNumber: 3,
  selection: {
    text: 'curiouser and curiouser',
    startCfi: 'epubcfi(/6/4!/4/2,/1:10,/1:20)',
    endCfi: 'epubcfi(/6/4!/4/2,/1:20,/1:33)',
  },
};

describe('getReadingContext tool', () => {
  it('round-trips through ToolRegistry and returns the provider snapshot', async () => {
    const reg = new ToolRegistry();
    reg.register(createGetReadingContextTool(() => readingSnapshot));
    const out = await reg.invoke('getReadingContext', {}, ctxFor());
    expect(out).toEqual(readingSnapshot);
  });

  it('declares permission=read so the registry skips the permission prompt', async () => {
    const reqPerm = vi.fn(async () => true);
    const reg = new ToolRegistry();
    reg.register(createGetReadingContextTool(() => readingSnapshot));
    await reg.invoke('getReadingContext', {}, ctxFor({ requestPermission: reqPerm }));
    expect(reqPerm).not.toHaveBeenCalled();
  });
});

describe('getSelection tool', () => {
  it('returns the active selection wrapped under { selection }', async () => {
    const reg = new ToolRegistry();
    reg.register(createGetSelectionTool(() => readingSnapshot.selection ?? null));
    const out = (await reg.invoke('getSelection', {}, ctxFor())) as { selection: unknown };
    expect(out.selection).toEqual(readingSnapshot.selection);
  });

  it('returns { selection: null } when nothing is selected', async () => {
    const reg = new ToolRegistry();
    reg.register(createGetSelectionTool(() => null));
    const out = (await reg.invoke('getSelection', {}, ctxFor())) as { selection: unknown };
    expect(out.selection).toBeNull();
  });
});

describe('lookupPassage (Phase 2.4 wrapper) tool', () => {
  function fakeRetriever(result: RetrieverResult): BookRetriever {
    return { search: vi.fn(async () => result) } as unknown as BookRetriever;
  }
  const model: EmbeddingModel = {
    id: 'fake',
    dim: 4,
    async embed(texts) {
      return texts.map(() => [1, 0, 0, 0]);
    },
  };

  it('maps RetrievedChunk[] into the slimmer LookupPassageResult shape', async () => {
    const retriever = fakeRetriever({
      passages: [
        {
          id: 'c1',
          bookHash: 'bk1',
          cfi: 'epubcfi(/6/2!/4/2)',
          endCfi: 'epubcfi(/6/2!/4/4)',
          sectionIndex: 0,
          chapterTitle: 'Ch1',
          text: 'hello',
          positionIndex: 0,
          score: 0.5,
        },
      ],
      status: 'ok',
    });
    const reg = new ToolRegistry();
    reg.register(
      createLookupPassageTool({ bookHash: 'bk1', retriever, activeEmbeddingModel: model }),
    );
    const out = (await reg.invoke('lookupPassage', { query: 'hello', topK: 3 }, ctxFor())) as {
      passages: Array<{ cfi: string; chapter: string | null }>;
      status: string;
    };
    expect(out.status).toBe('ok');
    expect(out.passages).toHaveLength(1);
    expect(out.passages[0]!.cfi).toBe('epubcfi(/6/2!/4/2)');
    expect(out.passages[0]!.chapter).toBe('Ch1');
  });

  it('forwards spoilerBoundPosition through to BookRetriever.search', async () => {
    const retriever = fakeRetriever({ passages: [], status: 'ok' });
    const reg = new ToolRegistry();
    reg.register(
      createLookupPassageTool({ bookHash: 'bk1', retriever, activeEmbeddingModel: model }),
    );
    await reg.invoke('lookupPassage', { query: 'q', topK: 3, spoilerBoundPosition: 7 }, ctxFor());
    expect(retriever.search).toHaveBeenCalledWith(
      expect.objectContaining({ spoilerBoundPosition: 7 }),
    );
  });
});

describe('addCitation tool', () => {
  it('invokes onCite with the parsed citation and returns ok', async () => {
    const onCite = vi.fn();
    const reg = new ToolRegistry();
    reg.register(createAddCitationTool(onCite));
    const out = await reg.invoke(
      'addCitation',
      {
        cfi: 'epubcfi(/6/2!/4/2)',
        snippet: 'quoted text',
        chapterTitle: 'Ch1',
        sectionIndex: 0,
      },
      ctxFor(),
    );
    expect(out).toEqual({ ok: true });
    expect(onCite).toHaveBeenCalledWith(
      expect.objectContaining({
        cfi: 'epubcfi(/6/2!/4/2)',
        snippet: 'quoted text',
        chapterTitle: 'Ch1',
        sectionIndex: 0,
      }),
    );
  });

  it('rejects oversized snippets via the Zod schema', async () => {
    const reg = new ToolRegistry();
    reg.register(createAddCitationTool(vi.fn()));
    await expect(
      reg.invoke('addCitation', { cfi: 'epubcfi(/6/2)', snippet: 'x'.repeat(2_001) }, ctxFor()),
    ).rejects.toMatchObject({ kind: 'tool_invalid_args' });
  });
});

describe('navigateToCfi tool', () => {
  it('declares permission=navigate so the registry prompts before invoking', async () => {
    const reqPerm = vi.fn(async () => true);
    const navigate = vi.fn(async () => ({ navigated: true }));
    const reg = new ToolRegistry();
    reg.register(createNavigateToCfiTool(navigate));
    await reg.invoke(
      'navigateToCfi',
      { cfi: 'epubcfi(/6/2)' },
      ctxFor({ requestPermission: reqPerm }),
    );
    expect(reqPerm).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('epubcfi(/6/2)');
  });

  it('throws tool_permission_denied when the user refuses', async () => {
    const navigate = vi.fn(async () => ({ navigated: true }));
    const reg = new ToolRegistry();
    reg.register(createNavigateToCfiTool(navigate));
    await expect(
      reg.invoke(
        'navigateToCfi',
        { cfi: 'epubcfi(/6/2)' },
        ctxFor({ requestPermission: vi.fn(async () => false) }),
      ),
    ).rejects.toMatchObject({ kind: 'tool_permission_denied' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('serializes concurrent navigations (parallelSafe=false)', async () => {
    let active = 0;
    let maxActive = 0;
    const navigate = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { navigated: true };
    });
    const reg = new ToolRegistry();
    reg.register(createNavigateToCfiTool(navigate));
    const ctx = ctxFor();
    await Promise.all([
      reg.invoke('navigateToCfi', { cfi: 'a' }, ctx),
      reg.invoke('navigateToCfi', { cfi: 'b' }, ctx),
      reg.invoke('navigateToCfi', { cfi: 'c' }, ctx),
    ]);
    expect(maxActive).toBe(1);
  });
});

describe('createHighlight tool', () => {
  it('persists via the injected annotation service and returns the id', async () => {
    const services = { createHighlight: vi.fn(async () => ({ id: 'h-1' })) };
    const reg = new ToolRegistry();
    reg.register(createCreateHighlightTool(services));
    const out = await reg.invoke(
      'createHighlight',
      { cfi: 'epubcfi(/6/2)', text: 'quoted', color: 'yellow' },
      ctxFor(),
    );
    expect(out).toEqual({ id: 'h-1' });
    expect(services.createHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: 'epubcfi(/6/2)', text: 'quoted', color: 'yellow' }),
    );
  });

  it('rejects unknown colors via the Zod enum', async () => {
    const reg = new ToolRegistry();
    reg.register(createCreateHighlightTool({ createHighlight: vi.fn() }));
    await expect(
      reg.invoke(
        'createHighlight',
        { cfi: 'epubcfi(/6/2)', text: 'x', color: 'magenta' },
        ctxFor(),
      ),
    ).rejects.toMatchObject({ kind: 'tool_invalid_args' });
  });

  it('write tools always prompt for permission', async () => {
    const reqPerm = vi.fn(async () => true);
    const reg = new ToolRegistry();
    reg.register(createCreateHighlightTool({ createHighlight: vi.fn(async () => ({ id: 'x' })) }));
    await reg.invoke(
      'createHighlight',
      { cfi: 'epubcfi(/6/2)', text: 'x' },
      ctxFor({ requestPermission: reqPerm }),
    );
    expect(reqPerm).toHaveBeenCalledTimes(1);
  });
});

describe('createNote tool', () => {
  it('persists the note via the injected annotation service', async () => {
    const services = { createNote: vi.fn(async () => ({ id: 'n-1' })) };
    const reg = new ToolRegistry();
    reg.register(createCreateNoteTool(services));
    const out = await reg.invoke(
      'createNote',
      {
        cfi: 'epubcfi(/6/2)',
        quotedText: 'curiouser',
        note: 'reminds me of Alice in Wonderland',
      },
      ctxFor(),
    );
    expect(out).toEqual({ id: 'n-1' });
    expect(services.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ quotedText: 'curiouser', note: expect.any(String) }),
    );
  });
});
