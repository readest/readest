export interface BoundedArtifact {
  bookHash: string;
  maxPageIncluded: number;
  lastUpdated: number;
  version: number;
}

export type XRayEntityType =
  | 'character'
  | 'location'
  | 'organization'
  | 'artifact'
  | 'term'
  | 'event'
  | 'theme'
  | 'concept';

export interface XRayEvidence {
  quote: string;
  page: number;
  chunkId: string;
  textUnitId?: string;
  offsetStart?: number;
  offsetEnd?: number;
  confidence?: number;
  inferred?: boolean;
}

export interface XRayFact {
  key: string;
  value: string;
  evidence: XRayEvidence[];
  inferred?: boolean;
}

export interface XRayEntity extends BoundedArtifact {
  id: string;
  type: XRayEntityType;
  canonicalName: string;
  aliases: string[];
  description: string;
  firstSeenPage: number;
  lastSeenPage: number;
  facts: XRayFact[];
  embedding?: number[];
}

export interface XRayRelationship extends BoundedArtifact {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description: string;
  evidence: XRayEvidence[];
  confidence?: number;
  inferred?: boolean;
  inferenceMethod?: 'triadic' | 'cooccurrence' | 'temporal' | 'llm';
  firstSeenPage: number;
  lastSeenPage: number;
}

export interface XRayTimelineEvent extends BoundedArtifact {
  id: string;
  page: number;
  summary: string;
  importance: number;
  involvedEntityIds: string[];
  evidence: XRayEvidence[];
}

export interface XRayClaim extends BoundedArtifact {
  id: string;
  type: string;
  subjectId?: string;
  objectId?: string;
  description: string;
  status?: 'TRUE' | 'FALSE' | 'SUSPECTED';
  evidence: XRayEvidence[];
}

export interface XRayTextUnit {
  id: string;
  bookHash: string;
  chunkId: string;
  page: number;
  text: string;
  entityIds?: string[];
  relationshipIds?: string[];
}

export interface XRayState {
  bookHash: string;
  lastAnalyzedPage: number;
  lastUpdated: number;
  version: number;
  lastReadAt?: number;
  lastRecapAt?: number;
  lastRecapPage?: number;
  lastRecapText?: string;
}

export interface XRayAliasEntry {
  key: string;
  bookHash: string;
  alias: string;
  normalized: string;
  entityIds: string[];
  lastUpdated: number;
}

export interface XRayExtractionEvidence {
  quote: string;
  page: number;
  chunkId: string;
  confidence?: number;
  inferred?: boolean;
}

export interface XRayExtractionFact {
  key: string;
  value: string;
  evidence: XRayExtractionEvidence[];
  inferred?: boolean;
}

export interface XRayExtractionEntity {
  name: string;
  type: XRayEntityType;
  aliases: string[];
  description: string;
  first_seen_page: number;
  last_seen_page: number;
  facts: XRayExtractionFact[];
}

export interface XRayExtractionRelationship {
  source: string;
  target: string;
  type: string;
  description: string;
  evidence: XRayExtractionEvidence[];
  inferred?: boolean;
  first_seen_page: number;
  last_seen_page: number;
}

export interface XRayExtractionEvent {
  page: number;
  summary: string;
  importance: number;
  involved_entities: string[];
  evidence: XRayExtractionEvidence[];
}

export interface XRayExtractionClaim {
  type: string;
  subject?: string;
  object?: string;
  description: string;
  status?: 'TRUE' | 'FALSE' | 'SUSPECTED';
  evidence: XRayExtractionEvidence[];
}

export interface XRayExtractionV1 {
  entities: XRayExtractionEntity[];
  relationships: XRayExtractionRelationship[];
  events: XRayExtractionEvent[];
  claims: XRayExtractionClaim[];
}

export interface XRayLookupResult {
  term: string;
  summary: string;
  evidence: XRayEvidence[];
  source: 'entity' | 'lexrank' | 'llm' | 'none';
  entity?: XRayEntity;
  maxPageIncluded: number;
}

export interface XRaySnapshot {
  entities: XRayEntity[];
  relationships: XRayRelationship[];
  events: XRayTimelineEvent[];
  claims: XRayClaim[];
  maxPageIncluded: number;
  lastUpdated: number;
}

export interface XRayExtractionCacheEntry {
  key: string;
  bookHash: string;
  chunkHash: string;
  promptVersion: number;
  extraction: XRayExtractionV1;
  timestamp: number;
}

// user override types for manual entity management
export interface XRayUserOverride extends BoundedArtifact {
  id: string;
  type: 'merge' | 'split' | 'pin' | 'rename' | 'delete';
  entityId?: string;
  targetEntityIds?: string[];
  newName?: string;
  newType?: XRayEntityType;
  reason?: string;
  appliedAt: number;
}

export interface XRayMergeOverride extends XRayUserOverride {
  type: 'merge';
  entityId: string;
  targetEntityIds: string[];
}

export interface XRaySplitOverride extends XRayUserOverride {
  type: 'split';
  entityId: string;
  newName: string;
}

export interface XRayPinOverride extends XRayUserOverride {
  type: 'pin';
  entityId: string;
}

export interface XRayRenameOverride extends XRayUserOverride {
  type: 'rename';
  entityId: string;
  newName: string;
  newType?: XRayEntityType;
}

export interface XRayDeleteOverride extends XRayUserOverride {
  type: 'delete';
  entityId: string;
}
