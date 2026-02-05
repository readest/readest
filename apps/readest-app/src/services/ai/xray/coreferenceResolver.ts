import type { XRayEntity, XRayTextUnit } from './types';

export interface CoreferenceMapping {
  mention: string;
  resolvedEntityId: string;
  textUnitId: string;
  confidence: number;
  page: number;
  offsetStart: number;
  offsetEnd: number;
}

export class CoreferenceResolver {
  private readonly pronouns = ['he', 'she', 'they', 'him', 'her', 'them', 'his', 'their'];
  private recentEntities: Array<{ entity: XRayEntity; page: number }> = [];
  private readonly maxRecentEntities = 5;

  async resolveCoreferences(
    textUnits: XRayTextUnit[],
    knownEntities: XRayEntity[],
    yieldIfNeeded?: () => Promise<void>,
  ): Promise<CoreferenceMapping[]> {
    const mappings: CoreferenceMapping[] = [];
    const normalizedVariants = knownEntities.map((entity) => {
      const variants = [entity.canonicalName, ...entity.aliases]
        .map((variant) => this.normalizeName(variant))
        .filter(Boolean);
      return { entity, variants: Array.from(new Set(variants)) };
    });
    const pronounPatterns = this.pronouns.map((pronoun) => ({
      pronoun,
      pattern: new RegExp(`\\b${pronoun}\\b`, 'gi'),
    }));

    for (const unit of textUnits) {
      const text = unit.text;
      const textLower = text.toLowerCase();

      for (const entry of normalizedVariants) {
        for (const variant of entry.variants) {
          if (!variant) continue;
          if (textLower.includes(variant)) {
            this.addToRecentEntities(entry.entity, unit.page);
            break;
          }
        }
      }

      for (const { pronoun, pattern } of pronounPatterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
          const resolvedEntity = this.resolvePronoun(pronoun, unit.page);
          if (resolvedEntity) {
            mappings.push({
              mention: pronoun,
              resolvedEntityId: resolvedEntity.id,
              textUnitId: unit.id,
              confidence: 0.6,
              page: unit.page,
              offsetStart: match.index,
              offsetEnd: match.index + pronoun.length,
            });
          }
        }
      }

      if (yieldIfNeeded) await yieldIfNeeded();
    }

    return mappings;
  }

  private resolvePronoun(pronoun: string, currentPage: number): XRayEntity | null {
    const pronounLower = pronoun.toLowerCase();
    const isPlural = pronounLower === 'they' || pronounLower === 'them' || pronounLower === 'their';

    const candidates = this.recentEntities.filter((item) => {
      if (isPlural) {
        return item.entity.type === 'organization' || item.page >= currentPage - 3;
      }
      return item.entity.type === 'character';
    });

    if (candidates.length === 0) {
      return this.recentEntities[0]?.entity ?? null;
    }

    return candidates[0]!.entity;
  }

  private addToRecentEntities(entity: XRayEntity, page: number): void {
    this.recentEntities = this.recentEntities.filter((item) => item.entity.id !== entity.id);
    this.recentEntities.unshift({ entity, page });
    if (this.recentEntities.length > this.maxRecentEntities) {
      this.recentEntities = this.recentEntities.slice(0, this.maxRecentEntities);
    }
  }

  private normalizeName(name: string): string {
    return name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
  }
}
