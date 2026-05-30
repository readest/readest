import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_POLICY,
  buildPromptContext,
  createBookMemoryLayer,
  createPolicyLayer,
  createReadingLayer,
  createSkillLayer,
  createToolCatalogLayer,
  createUserMemoryLayer,
  estimateChars,
  estimateTokens,
} from '@/services/reedy/context';
import type { ChatModel } from '@/services/reedy/models/ChatModel';
import type { ReedyTool } from '@/services/reedy/tools/types';
import type { ReadingContextSnapshot } from '@/services/reedy/tools/builtins/types';

function fakeModel(overrides: Partial<ChatModel> = {}): ChatModel {
  return {
    id: 'fake-model',
    contextWindow: 8_192,
    reservedOutput: 1_024,
    supportsTools: true,
    getLanguageModel: () =>
      ({ __mock: 'lm' }) as unknown as ReturnType<ChatModel['getLanguageModel']>,
    ...overrides,
  };
}

function tinyTool(name: string, description = 'desc'): ReedyTool {
  return {
    name,
    description,
    permission: 'read',
    parallelSafe: true,
    inputSchema: z.object({}),
    async run() {
      return null;
    },
  };
}

const readingSnap: ReadingContextSnapshot = {
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

describe('tokenBudget', () => {
  it('estimateTokens is ~chars/4', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hi')).toBe(1);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });

  it('estimateChars is the inverse', () => {
    expect(estimateChars(100)).toBe(400);
    expect(estimateChars(0)).toBe(0);
  });
});

describe('PolicyLayer + SkillLayer (non-expendable)', () => {
  it('PolicyLayer always renders the provided policy', () => {
    const layer = createPolicyLayer(DEFAULT_POLICY);
    expect(layer.render()).toContain('Reedy');
    expect(layer.expendable).toBe(false);
  });

  it('SkillLayer renders null when no skill is active', () => {
    expect(createSkillLayer(null).render()).toBeNull();
  });

  it('SkillLayer renders id + instructions when present', () => {
    const layer = createSkillLayer({ id: 'spoiler-free', instructions: 'Avoid spoilers.' });
    expect(layer.render()).toContain('spoiler-free');
    expect(layer.render()).toContain('Avoid spoilers');
  });
});

describe('ReadingLayer (expendable, shrinkable)', () => {
  const layer = createReadingLayer(readingSnap);

  it('level 0 renders chapter + page + CFI + selection', () => {
    const out = layer.render()!;
    expect(out).toContain('Down the Rabbit Hole');
    expect(out).toContain('Page: 3');
    expect(out).toContain('curiouser');
  });

  it('level 1 collapses to a single-line summary', () => {
    const out = layer.shrink(1)!;
    expect(out).toContain('Down the Rabbit Hole');
    expect(out).not.toContain('curiouser');
  });

  it('level 2+ drops the layer entirely', () => {
    expect(layer.shrink(2)).toBeNull();
    expect(layer.shrink(99)).toBeNull();
  });

  it('truncates very long selections at level 0 to keep the prompt small', () => {
    const longSel: ReadingContextSnapshot = {
      ...readingSnap,
      selection: {
        text: 'x'.repeat(2_000),
        startCfi: readingSnap.selection!.startCfi,
        endCfi: readingSnap.selection!.endCfi,
      },
    };
    const out = createReadingLayer(longSel).render()!;
    expect(out.length).toBeLessThan(600);
    expect(out).toContain('Active selection (2000 chars)');
  });
});

describe('ToolCatalogLayer', () => {
  it('lists tool name + description at level 0', () => {
    const layer = createToolCatalogLayer([
      tinyTool('a', 'finds things'),
      tinyTool('b', 'navigates'),
    ]);
    const out = layer.render()!;
    expect(out).toContain('a: finds things');
    expect(out).toContain('b: navigates');
  });

  it('collapses to comma-list at level 1', () => {
    const layer = createToolCatalogLayer([tinyTool('a'), tinyTool('b')]);
    expect(layer.shrink(1)).toBe('Available tools: a, b.');
  });

  it('returns null when no tools registered', () => {
    expect(createToolCatalogLayer([]).render()).toBeNull();
  });
});

describe('Memory layers (Phase 3 placeholders)', () => {
  it('render null when provider returns empty', () => {
    expect(createBookMemoryLayer(() => '').render()).toBeNull();
    expect(createUserMemoryLayer(() => '   ').render()).toBeNull();
  });

  it('render headlined body when provider returns text', () => {
    const out = createBookMemoryLayer(() => 'Theme: identity.\nProtagonist: Alice.').render();
    expect(out).toMatch(/^Book memory:/);
    expect(out).toContain('Alice');
  });

  it('UserMemory shrinks later than BookMemory (higher shrinkPriority)', () => {
    const book = createBookMemoryLayer(() => 'x');
    const user = createUserMemoryLayer(() => 'x');
    expect(user.shrinkPriority).toBeGreaterThan(book.shrinkPriority);
  });
});

describe('buildPromptContext', () => {
  it('emits a non-shrunk prompt when everything fits in budget', () => {
    const ctx = buildPromptContext({
      model: fakeModel({ contextWindow: 32_000, reservedOutput: 1_000 }),
      layers: [
        createPolicyLayer('You are Reedy.'),
        createSkillLayer({ id: 'sum', instructions: 'Summarize.' }),
        createReadingLayer(readingSnap),
        createToolCatalogLayer([tinyTool('lookupPassage', 'search the book')]),
        createBookMemoryLayer(() => ''),
        createUserMemoryLayer(() => ''),
      ],
    });
    expect(ctx.truncated).toEqual([]);
    expect(ctx.system).toContain('You are Reedy.');
    expect(ctx.system).toContain('Active skill: sum');
    expect(ctx.system).toContain('Down the Rabbit Hole');
    expect(ctx.system).toContain('lookupPassage');
    // historyBudget > 0 — there's lots of room left over.
    expect(ctx.historyBudget).toBeGreaterThan(0);
  });

  it('shrinks ToolCatalog first when over budget', () => {
    // Tiny budget so only Policy + Skill survive at full size.
    const layers = [
      createPolicyLayer('P'),
      createSkillLayer({ id: 'sk', instructions: 'I' }),
      createReadingLayer(readingSnap),
      createToolCatalogLayer(
        Array.from({ length: 20 }, (_, i) =>
          tinyTool(`tool${i}`, `does thing number ${i} with elaborate explanation`),
        ),
      ),
    ];
    const ctx = buildPromptContext({
      model: fakeModel({ contextWindow: 350, reservedOutput: 32 }),
      layers,
      safetyMarginTokens: 8,
    });
    expect(ctx.truncated[0]).toBe('toolCatalog');
    expect(ctx.usedTokens).toBeLessThanOrEqual(ctx.totalBudget);
  });

  it('orders shrinking per plan §2.5 — toolCatalog → reading → bookMemory → userMemory', () => {
    const ctx = buildPromptContext({
      model: fakeModel({ contextWindow: 200, reservedOutput: 16 }),
      layers: [
        createPolicyLayer('P'),
        createSkillLayer(null),
        createReadingLayer(readingSnap),
        createToolCatalogLayer([
          tinyTool('a', 'aaaa '.repeat(40)),
          tinyTool('b', 'bbbb '.repeat(40)),
        ]),
        createBookMemoryLayer(() => 'long book memory '.repeat(20)),
        createUserMemoryLayer(() => 'long user memory '.repeat(20)),
      ],
      safetyMarginTokens: 4,
    });
    // The first three truncations should match the plan ordering.
    expect(ctx.truncated.slice(0, 3)).toEqual(['toolCatalog', 'reading', 'bookMemory']);
  });

  it('never shrinks Policy or Skill even under heavy budget pressure', () => {
    const ctx = buildPromptContext({
      model: fakeModel({ contextWindow: 200, reservedOutput: 16 }),
      layers: [
        createPolicyLayer('Policy that must survive shrinkage.'),
        createSkillLayer({ id: 'sk', instructions: 'Skill survives too.' }),
        createReadingLayer(readingSnap),
        createToolCatalogLayer([tinyTool('a', 'x'.repeat(400))]),
      ],
      safetyMarginTokens: 4,
    });
    expect(ctx.system).toContain('Policy that must survive shrinkage');
    expect(ctx.system).toContain('Skill survives too');
    expect(ctx.truncated).not.toContain('policy');
    expect(ctx.truncated).not.toContain('skill:sk');
  });

  it('returns an empty prompt when every layer renders null', () => {
    const ctx = buildPromptContext({
      model: fakeModel(),
      layers: [
        createSkillLayer(null),
        createReadingLayer(null),
        createToolCatalogLayer([]),
        createBookMemoryLayer(() => ''),
        createUserMemoryLayer(() => ''),
      ],
    });
    expect(ctx.system).toBe('');
    expect(ctx.usedTokens).toBe(0);
    expect(ctx.historyBudget).toBe(ctx.totalBudget);
  });
});
