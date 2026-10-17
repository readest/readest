import { describe, expect, test } from 'vitest';

import type {
  XRayModelEvidence,
  XRayModelExtraction,
  XRaySourceUnit,
} from '@/services/ai/xray/types';
import {
  validateEvidence,
  validateXRayExtraction,
  xrayEntityTypeSchema,
} from '@/services/ai/xray/validators';

const sourceUnits: readonly XRaySourceUnit[] = [
  {
    unitId: 'unit-1',
    text: 'Alice found the brass key beside the river.',
    startCfi: 'epubcfi(/6/2!/4/2/1:0)',
    endCfi: 'epubcfi(/6/2!/4/2/1:44)',
    sectionIndex: 1,
    positionIndex: 4,
    displayPage: '12',
  },
  {
    unitId: 'unit-2',
    text: 'Beyond the gate, the future waited.',
    startCfi: 'epubcfi(/6/4!/4/2/1:0)',
    endCfi: 'epubcfi(/6/4!/4/2/1:36)',
    sectionIndex: 2,
    positionIndex: 9,
    displayPage: '18',
  },
];

const evidence = (
  exactQuote = 'Alice found the brass key',
  unitId = 'unit-1',
): XRayModelEvidence => ({
  unitId,
  exactQuote,
  confidence: 0.9,
  inferred: false,
});

const extraction = (itemEvidence: readonly XRayModelEvidence[]): XRayModelExtraction => ({
  entities: [
    {
      name: 'Alice',
      type: 'character',
      aliases: ['A.'],
      description: 'The finder of the brass key.',
      evidence: itemEvidence,
      facts: [
        {
          key: 'discovery',
          value: 'Found a brass key.',
          evidence: itemEvidence,
        },
      ],
    },
  ],
  relationships: [
    {
      source: 'Alice',
      target: 'brass key',
      type: 'found',
      description: 'Alice found the key.',
      evidence: itemEvidence,
    },
  ],
  events: [
    {
      summary: 'Alice finds a brass key.',
      importance: 7,
      involvedEntities: ['Alice', 'brass key'],
      evidence: itemEvidence,
    },
  ],
  claims: [
    {
      type: 'observation',
      subject: 'Alice',
      object: 'brass key',
      description: 'Alice has the brass key.',
      status: 'true',
      evidence: itemEvidence,
    },
  ],
});

describe('xrayEntityTypeSchema', () => {
  test('accepts supported types and rejects unknown types', () => {
    expect(xrayEntityTypeSchema.safeParse('character').success).toBe(true);
    expect(xrayEntityTypeSchema.safeParse('theme').success).toBe(false);
  });
});

describe('validateEvidence', () => {
  test('rejects unknown units, inexact quotes, and future positions', () => {
    expect(validateEvidence([evidence('Alice found', 'missing')], sourceUnits, 4)).toEqual([]);
    expect(validateEvidence([evidence('alice found the brass key')], sourceUnits, 4)).toEqual([]);
    const future = evidence('Beyond the gate', 'unit-2');
    expect(validateEvidence([future], sourceUnits, 4)).toEqual([]);
  });

  test('derives direct navigation and keeps inferred evidence non-navigable', () => {
    const inferred: XRayModelEvidence = {
      ...evidence(),
      confidence: 0.6,
      inferred: true,
    };
    expect(validateEvidence([evidence(), inferred], sourceUnits, 4)).toEqual([
      {
        unitId: 'unit-1',
        exactQuote: 'Alice found the brass key',
        startCfi: 'epubcfi(/6/2!/4/2/1:0)',
        endCfi: 'epubcfi(/6/2!/4/2/1:44)',
        sectionIndex: 1,
        positionIndex: 4,
        displayPage: '12',
        confidence: 0.9,
        inferred: false,
      },
      {
        unitId: 'unit-1',
        exactQuote: 'Alice found the brass key',
        startCfi: null,
        endCfi: null,
        sectionIndex: 1,
        positionIndex: 4,
        displayPage: '12',
        confidence: 0.6,
        inferred: true,
      },
    ]);
  });
});

describe('validateXRayExtraction', () => {
  test('keeps valid artifacts and drops artifacts without valid evidence', () => {
    const invalidEvidence = [evidence('A quote that is not in the unit')];
    expect(validateXRayExtraction(extraction(invalidEvidence), sourceUnits, 4)).toEqual({
      entities: [],
      relationships: [],
      events: [],
      claims: [],
    });

    const valid = validateXRayExtraction(extraction([evidence()]), sourceUnits, 4);
    expect(valid.entities).toHaveLength(1);
    expect(valid.entities[0]?.facts).toHaveLength(1);
    expect(valid.relationships).toHaveLength(1);
    expect(valid.events).toHaveLength(1);
    expect(valid.claims).toHaveLength(1);
  });
});
