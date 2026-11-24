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

/** A verbatim quote from the book, and where it is. */
export interface XRayQuote {
  text: string;
  cfi: string;
}

export interface XRayFact {
  key: string;
  value: string;
}

export interface XRayEntity {
  name: string;
  type: XRayEntityType;
  aliases: string[];
  description: string;
  facts: XRayFact[];
  quotes: XRayQuote[];
}

export interface XRayRelationship {
  source: string;
  target: string;
  type: string;
  quotes: XRayQuote[];
}

interface XRayEvent {
  summary: string;
  quotes: XRayQuote[];
}

export interface XRayData {
  entities: XRayEntity[];
  relationships: XRayRelationship[];
  events: XRayEvent[];
}
