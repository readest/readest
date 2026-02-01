import type { XRayEntity, XRayRelationship, XRayEvidence } from './types';

export interface PossessiveChain {
  rootEntity: string;
  chain: string[];
  fullText: string;
  page: number;
  chunkId: string;
}

export interface PossessiveInferenceResult {
  entities: XRayEntity[];
  relationships: XRayRelationship[];
}

export class PossessiveParser {
  private readonly possessivePattern = /(\w+(?:'s|\s+))\s*(\w+(?:'s|\s+)?)/g;
  private readonly relationKeywords = [
    'brother',
    'sister',
    'son',
    'daughter',
    'father',
    'mother',
    'wife',
    'husband',
    'spouse',
    'friend',
    'enemy',
    'mentor',
    'teacher',
    'student',
    'apprentice',
  ];
  private readonly pronouns = new Set([
    'i',
    'me',
    'my',
    'mine',
    'we',
    'our',
    'ours',
    'you',
    'your',
    'yours',
    'he',
    'him',
    'his',
    'she',
    'her',
    'hers',
    'they',
    'them',
    'their',
    'theirs',
    'it',
    'its',
  ]);

  parsePossessiveChains(text: string, page: number, chunkId: string): PossessiveChain[] {
    const chains: PossessiveChain[] = [];
    let match;

    while ((match = this.possessivePattern.exec(text)) !== null) {
      const chain = this.extractChain(match[0], text);
      if (chain && chain.chain.length >= 1) {
        chains.push({
          ...chain,
          page,
          chunkId,
        });
      }
    }

    return chains;
  }

  generateImpliedEntitiesAndRelationships(
    chains: PossessiveChain[],
    existingEntities: XRayEntity[],
    bookHash: string,
    maxPage: number,
  ): PossessiveInferenceResult {
    const result: PossessiveInferenceResult = {
      entities: [],
      relationships: [],
    };

    const entityByName = new Map(
      existingEntities.map((e) => [this.normalizeName(e.canonicalName), e]),
    );

    for (const chain of chains) {
      const rootNormalized = this.normalizeName(chain.rootEntity);
      if (this.isPronoun(rootNormalized)) continue;
      const rootEntity = entityByName.get(rootNormalized);

      if (!rootEntity) continue;

      let currentEntity = rootEntity;

      for (const relation of chain.chain) {
        const relationClean = relation.trim();
        if (!this.isAllowedRelation(relationClean)) break;
        const impliedName = `${currentEntity.canonicalName}'s ${relationClean}`;
        const impliedNormalized = this.normalizeName(impliedName);

        let impliedEntity = entityByName.get(impliedNormalized);

        if (!impliedEntity) {
          const now = Date.now();
          impliedEntity = {
            id: `xray_${impliedNormalized}_${now}`,
            type: 'character',
            canonicalName: impliedName,
            aliases: [impliedName],
            description: `${relationClean} of ${currentEntity.canonicalName}`,
            firstSeenPage: chain.page,
            lastSeenPage: chain.page,
            facts: [],
            bookHash,
            maxPageIncluded: maxPage,
            lastUpdated: now,
            version: 1,
          };
          result.entities.push(impliedEntity);
          entityByName.set(impliedNormalized, impliedEntity);
        }
        const now = Date.now();
        const relationshipType = this.inferRelationshipType(relationClean);
        result.relationships.push({
          id: `xray_rel_${currentEntity.id}_${impliedEntity.id}_${now}`,
          sourceId: currentEntity.id,
          targetId: impliedEntity.id,
          type: relationshipType,
          description: `${currentEntity.canonicalName} ${relationshipType} ${impliedEntity.canonicalName}`,
          evidence: [this.createEvidence(chain.fullText, chain.page, chain.chunkId)],
          confidence: 0.7,
          inferred: true,
          inferenceMethod: 'llm',
          firstSeenPage: chain.page,
          lastSeenPage: chain.page,
          bookHash,
          maxPageIncluded: maxPage,
          lastUpdated: now,
          version: 1,
        });

        currentEntity = impliedEntity;
      }
    }

    return result;
  }

  private extractChain(matchText: string, _fullText: string): PossessiveChain | null {
    const parts = matchText.split(/'s\s*|\s+/).filter((p) => p.length > 0);

    if (parts.length < 2) return null;

    return {
      rootEntity: parts[0]!,
      chain: parts.slice(1),
      fullText: matchText,
      page: 0,
      chunkId: '',
    };
  }

  private inferRelationshipType(relation: string): string {
    const relationLower = relation.toLowerCase();

    if (relationLower.includes('brother') || relationLower.includes('sister')) {
      return 'sibling_of';
    }
    if (relationLower.includes('son') || relationLower.includes('daughter')) {
      return 'parent_of';
    }
    if (relationLower.includes('father') || relationLower.includes('mother')) {
      return 'child_of';
    }
    if (relationLower.includes('wife') || relationLower.includes('husband')) {
      return 'spouse_of';
    }
    if (relationLower.includes('friend')) {
      return 'friend_of';
    }
    if (relationLower.includes('enemy')) {
      return 'enemy_of';
    }

    return 'related_to';
  }

  private createEvidence(quote: string, page: number, chunkId: string): XRayEvidence {
    return {
      quote,
      page,
      chunkId,
      confidence: 0.7,
      inferred: true,
    };
  }

  private normalizeName(name: string): string {
    return name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private isAllowedRelation(relation: string): boolean {
    const relationLower = relation.toLowerCase();
    return this.relationKeywords.some((keyword) => relationLower.includes(keyword));
  }

  private isPronoun(normalized: string): boolean {
    if (!normalized) return true;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length === 1 && this.pronouns.has(tokens[0]!);
  }
}
