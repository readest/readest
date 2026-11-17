import { z } from 'zod';

import { XRAY_ENTITY_TYPES } from './types';
import type {
  XRayEntity,
  XRayEvidenceLocator,
  XRayExtractionOutput,
  XRayFact,
  XRayModelEvidence,
  XRayModelExtraction,
  XRaySourceUnit,
} from './types';

const nonBlankString = z.string().refine((value) => value.trim().length > 0);

export const xrayEntityTypeSchema = z.enum(XRAY_ENTITY_TYPES);

export const xrayModelEvidenceSchema = z.object({
  unitId: z.string().trim().min(1),
  exactQuote: nonBlankString,
  confidence: z.number().min(0).max(1).optional().default(1),
  inferred: z.boolean().optional().default(false),
});

const evidenceListSchema = z.array(xrayModelEvidenceSchema).min(1);

export const xrayModelFactSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1),
  evidence: evidenceListSchema,
});

export const xrayModelEntitySchema = z.object({
  name: z.string().trim().min(1),
  type: xrayEntityTypeSchema,
  aliases: z.array(z.string().trim().min(1)).optional().default([]),
  description: z.string().trim().optional().default(''),
  evidence: evidenceListSchema,
  facts: z.array(xrayModelFactSchema).optional().default([]),
});

export const xrayModelRelationshipSchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
  description: z.string().trim().optional().default(''),
  evidence: evidenceListSchema,
});

export const xrayModelTimelineEventSchema = z.object({
  summary: z.string().trim().min(1),
  importance: z.number().int().min(1).max(10).optional().default(5),
  involvedEntities: z.array(z.string().trim().min(1)).optional().default([]),
  evidence: evidenceListSchema,
});

export const xrayModelClaimSchema = z.object({
  type: z.string().trim().min(1),
  subject: z.string().trim().min(1).optional(),
  object: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  status: z.enum(['true', 'false', 'suspected']).optional(),
  evidence: evidenceListSchema,
});

export const xrayExtractionSchema = z.object({
  entities: z.array(xrayModelEntitySchema).optional().default([]),
  relationships: z.array(xrayModelRelationshipSchema).optional().default([]),
  events: z.array(xrayModelTimelineEventSchema).optional().default([]),
  claims: z.array(xrayModelClaimSchema).optional().default([]),
});

const evidenceLocator = (item: XRayModelEvidence, unit: XRaySourceUnit): XRayEvidenceLocator => {
  const shared = {
    unitId: unit.unitId,
    exactQuote: item.exactQuote,
    sectionIndex: unit.sectionIndex,
    positionIndex: unit.positionIndex,
    ...(unit.displayPage === undefined ? {} : { displayPage: unit.displayPage }),
    confidence: item.confidence,
  };

  if (item.inferred) {
    return {
      ...shared,
      startCfi: null,
      endCfi: null,
      inferred: true,
    };
  }

  return {
    ...shared,
    startCfi: unit.startCfi,
    endCfi: unit.endCfi,
    inferred: false,
  };
};

export const validateEvidence = (
  evidence: readonly XRayModelEvidence[],
  sourceUnits: readonly XRaySourceUnit[],
  maxPositionIndex: number,
): XRayEvidenceLocator[] => {
  const unitsById = new Map<string, XRaySourceUnit>();
  for (const unit of sourceUnits) {
    if (!unitsById.has(unit.unitId)) unitsById.set(unit.unitId, unit);
  }

  const valid: XRayEvidenceLocator[] = [];
  for (const item of evidence) {
    const unit = unitsById.get(item.unitId);
    if (!unit) continue;
    if (!Number.isInteger(unit.positionIndex) || unit.positionIndex < 0) continue;
    if (unit.positionIndex > maxPositionIndex) continue;
    if (!item.exactQuote || !unit.text.includes(item.exactQuote)) continue;
    valid.push(evidenceLocator(item, unit));
  }
  return valid;
};

const validateFacts = (
  facts: XRayModelExtraction['entities'][number]['facts'],
  sourceUnits: readonly XRaySourceUnit[],
  maxPositionIndex: number,
): XRayFact[] => {
  const validFacts: XRayFact[] = [];
  for (const fact of facts) {
    const evidence = validateEvidence(fact.evidence, sourceUnits, maxPositionIndex);
    if (evidence.length === 0) continue;
    validFacts.push({ key: fact.key, value: fact.value, evidence });
  }
  return validFacts;
};

const validateEntities = (
  entities: XRayModelExtraction['entities'],
  sourceUnits: readonly XRaySourceUnit[],
  maxPositionIndex: number,
): XRayEntity[] => {
  const validEntities: XRayEntity[] = [];
  for (const entity of entities) {
    const evidence = validateEvidence(entity.evidence, sourceUnits, maxPositionIndex);
    if (evidence.length === 0) continue;
    validEntities.push({
      name: entity.name,
      type: entity.type,
      aliases: [...entity.aliases],
      description: entity.description,
      evidence,
      facts: validateFacts(entity.facts, sourceUnits, maxPositionIndex),
    });
  }
  return validEntities;
};

export const validateXRayExtraction = (
  extraction: XRayModelExtraction,
  sourceUnits: readonly XRaySourceUnit[],
  maxPositionIndex: number,
): XRayExtractionOutput => ({
  entities: validateEntities(extraction.entities, sourceUnits, maxPositionIndex),
  relationships: extraction.relationships.flatMap((relationship) => {
    const evidence = validateEvidence(relationship.evidence, sourceUnits, maxPositionIndex);
    return evidence.length === 0 ? [] : [{ ...relationship, evidence }];
  }),
  events: extraction.events.flatMap((event) => {
    const evidence = validateEvidence(event.evidence, sourceUnits, maxPositionIndex);
    return evidence.length === 0
      ? []
      : [{ ...event, involvedEntities: [...event.involvedEntities], evidence }];
  }),
  claims: extraction.claims.flatMap((claim) => {
    const evidence = validateEvidence(claim.evidence, sourceUnits, maxPositionIndex);
    return evidence.length === 0 ? [] : [{ ...claim, evidence }];
  }),
});
