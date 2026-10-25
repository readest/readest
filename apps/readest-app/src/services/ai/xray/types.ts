export const XRAY_ENTITY_TYPES = [
  'character',
  'location',
  'organization',
  'artifact',
  'term',
  'event',
  'concept',
] as const;

export type XRayEntityType = (typeof XRAY_ENTITY_TYPES)[number];
export type XRayClaimStatus = 'true' | 'false' | 'suspected';

// CFI controls source admission. positionIndex bounds derived rows; displayPage is metadata only.
export interface XRaySourceLocator {
  readonly unitId: string;
  readonly startCfi: string;
  readonly endCfi: string;
  readonly sectionIndex: number;
  readonly positionIndex: number;
  readonly displayPage?: string | number;
}

export interface XRaySourceUnit extends XRaySourceLocator {
  readonly text: string;
}

interface XRayEvidenceBase {
  readonly unitId: string;
  readonly exactQuote: string;
  readonly sectionIndex: number;
  readonly positionIndex: number;
  readonly displayPage?: string | number;
  readonly confidence: number;
}

export interface XRayDirectEvidenceLocator extends XRayEvidenceBase {
  readonly startCfi: string;
  readonly endCfi: string;
  readonly inferred: false;
}

export interface XRayInferredEvidenceLocator extends XRayEvidenceBase {
  readonly startCfi: null;
  readonly endCfi: null;
  readonly inferred: true;
}

export type XRayEvidenceLocator = XRayDirectEvidenceLocator | XRayInferredEvidenceLocator;

export interface XRayModelEvidence {
  readonly unitId: string;
  readonly exactQuote: string;
  readonly confidence: number;
  readonly inferred: boolean;
}

export interface XRayModelFact {
  readonly key: string;
  readonly value: string;
  readonly evidence: readonly XRayModelEvidence[];
}

export interface XRayModelEntity {
  readonly name: string;
  readonly type: XRayEntityType;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly evidence: readonly XRayModelEvidence[];
  readonly facts: readonly XRayModelFact[];
}

export interface XRayModelRelationship {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly description: string;
  readonly evidence: readonly XRayModelEvidence[];
}

export interface XRayModelTimelineEvent {
  readonly summary: string;
  readonly importance: number;
  readonly involvedEntities: readonly string[];
  readonly evidence: readonly XRayModelEvidence[];
}

export interface XRayModelClaim {
  readonly type: string;
  readonly subject?: string;
  readonly object?: string;
  readonly description: string;
  readonly status?: XRayClaimStatus;
  readonly evidence: readonly XRayModelEvidence[];
}

export interface XRayModelExtraction {
  readonly entities: readonly XRayModelEntity[];
  readonly relationships: readonly XRayModelRelationship[];
  readonly events: readonly XRayModelTimelineEvent[];
  readonly claims: readonly XRayModelClaim[];
}

export interface XRayFact {
  readonly key: string;
  readonly value: string;
  readonly evidence: readonly XRayEvidenceLocator[];
}

export interface XRayEntity {
  readonly name: string;
  readonly type: XRayEntityType;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly evidence: readonly XRayEvidenceLocator[];
  readonly facts: readonly XRayFact[];
}

export interface XRayRelationship {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly description: string;
  readonly evidence: readonly XRayEvidenceLocator[];
}

export interface XRayTimelineEvent {
  readonly summary: string;
  readonly importance: number;
  readonly involvedEntities: readonly string[];
  readonly evidence: readonly XRayEvidenceLocator[];
}

export interface XRayClaim {
  readonly type: string;
  readonly subject?: string;
  readonly object?: string;
  readonly description: string;
  readonly status?: XRayClaimStatus;
  readonly evidence: readonly XRayEvidenceLocator[];
}

export interface XRayExtractionOutput {
  readonly entities: readonly XRayEntity[];
  readonly relationships: readonly XRayRelationship[];
  readonly events: readonly XRayTimelineEvent[];
  readonly claims: readonly XRayClaim[];
}

export interface XRayBookFingerprint {
  readonly bookHash: string;
  readonly contentHash: string;
}

export interface XRayExtractionBatch {
  readonly batchId: string;
  readonly fingerprint: XRayBookFingerprint;
  readonly sourceUnitIds: readonly string[];
  readonly minPositionIndex: number;
  readonly maxPositionIndex: number;
  readonly output: XRayExtractionOutput;
  readonly createdAt: number;
}

export interface XRayBookState {
  readonly fingerprint: XRayBookFingerprint;
  readonly maxPositionIndex: number;
  readonly pendingPositionIndex?: number;
  readonly lastBatchId?: string;
  readonly updatedAt: number;
  readonly version: number;
  readonly error?: string;
}

export interface XRaySnapshot extends XRayExtractionOutput {
  readonly fingerprint: XRayBookFingerprint;
  readonly maxPositionIndex: number;
  readonly updatedAt: number;
}

export interface XRayLookupResult {
  readonly term: string;
  readonly summary: string;
  readonly evidence: readonly XRayEvidenceLocator[];
  readonly source: 'entity' | 'lexrank' | 'none';
  readonly entity?: XRayEntity;
  readonly maxPositionIndex: number;
}

export interface XRayLookupCacheRow {
  readonly key: string;
  readonly bookHash: string;
  readonly maxPositionIndex: number;
  readonly fingerprint: XRayBookFingerprint;
  readonly result: XRayLookupResult;
}
