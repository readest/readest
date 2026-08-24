import { describe, expect, test } from 'vitest';

import type { XRaySourceUnit } from '@/services/ai/xray/types';
import {
  resolveCoreferences,
  type CoreferenceEntity,
} from '@/services/ai/xray/coreferenceResolver';

const units: readonly XRaySourceUnit[] = [
  {
    unitId: 'unit-1',
    text: 'Alice entered the hall. She waved.',
    startCfi: 'epubcfi(/6/2:0)',
    endCfi: 'epubcfi(/6/2:35)',
    sectionIndex: 0,
    positionIndex: 0,
  },
  {
    unitId: 'unit-2',
    text: 'The White Rabbit ran past. He vanished.',
    startCfi: 'epubcfi(/6/4:0)',
    endCfi: 'epubcfi(/6/4:39)',
    sectionIndex: 0,
    positionIndex: 1,
  },
];

const entities: readonly CoreferenceEntity[] = [
  {
    id: 'alice',
    type: 'character',
    canonicalName: 'Alice Liddell',
    aliases: ['Alice', 'ALICE', ' Ally '],
  },
  {
    id: 'rabbit',
    type: 'character',
    canonicalName: 'White Rabbit',
    aliases: ['The White Rabbit'],
  },
];

describe('resolveCoreferences', () => {
  test('resolves aliases and following pronouns without retaining cross-call state', () => {
    const expected = [
      {
        mention: 'Alice',
        resolvedEntityId: 'alice',
        unitId: 'unit-1',
        sectionIndex: 0,
        positionIndex: 0,
        offsetStart: 0,
        offsetEnd: 5,
        confidence: 1,
        kind: 'alias',
      },
      {
        mention: 'She',
        resolvedEntityId: 'alice',
        unitId: 'unit-1',
        sectionIndex: 0,
        positionIndex: 0,
        offsetStart: 24,
        offsetEnd: 27,
        confidence: 0.6,
        kind: 'pronoun',
      },
      {
        mention: 'The White Rabbit',
        resolvedEntityId: 'rabbit',
        unitId: 'unit-2',
        sectionIndex: 0,
        positionIndex: 1,
        offsetStart: 0,
        offsetEnd: 16,
        confidence: 1,
        kind: 'alias',
      },
      {
        mention: 'He',
        resolvedEntityId: 'rabbit',
        unitId: 'unit-2',
        sectionIndex: 0,
        positionIndex: 1,
        offsetStart: 27,
        offsetEnd: 29,
        confidence: 0.6,
        kind: 'pronoun',
      },
    ];

    expect(resolveCoreferences(units, entities)).toEqual(expected);
    expect(resolveCoreferences(units, [...entities].reverse())).toEqual(expected);
  });
});
