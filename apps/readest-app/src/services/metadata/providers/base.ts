import { MetadataProvider, SearchRequest, MetadataResult, Metadata } from '../types';

export abstract class BaseMetadataProvider implements MetadataProvider {
  abstract name: string;
  abstract label: string;
  maxResults = 5;

  protected abstract searchByISBN(isbn: string): Promise<Metadata[]>;
  protected abstract searchByTitle(
    title: string,
    author?: string,
    language?: string,
  ): Promise<Metadata[]>;

  async search(request: SearchRequest): Promise<MetadataResult[]> {
    const hasISBN = !!request.isbn && request.isbn.trim().length > 0;
    const hasTitle = !!request.title && request.title.trim().length > 0;

    let results: Metadata[] = [];

    try {
      if (hasISBN) {
        results = await this.searchByISBN(request.isbn!.trim());
      } else if (hasTitle) {
        results = await this.searchByTitle(
          request.title!.trim(),
          request.author?.trim(),
          request.language?.trim(),
        );
      }

      if (results && results.length > 0) {
        return results.map((metadata) => {
          const confidence = this.calculateConfidence(metadata, request);
          return {
            metadata,
            confidence,
            providerName: this.name,
            providerLabel: this.label,
          };
        });
      }

      return [];
    } catch (error) {
      console.error(`${this.name} provider search failed:`, error);
      throw error;
    }
  }

  protected calculateConfidence(metadata: Metadata, request: SearchRequest): number {
    let confidence = 50;

    // Higher confidence for ISBN matches
    if (request.isbn && metadata.identifier) {
      const cleanRequestIsbn = this.cleanISBN(request.isbn);
      const cleanMetadataIsbn = this.cleanISBN(metadata.identifier);
      if (cleanRequestIsbn === cleanMetadataIsbn) {
        confidence += 40;
      }
    }

    // Title match confidence
    if (request.title && metadata.title) {
      const titleSimilarity = this.calculateStringSimilarity(
        request.title.toLowerCase(),
        metadata.title.toLowerCase(),
      );
      confidence += Math.floor(titleSimilarity * 30);
    }

    // Author match confidence
    if (request.author && metadata.author) {
      const authorSimilarity = this.calculateStringSimilarity(
        request.author.toLowerCase(),
        metadata.author.toLowerCase(),
      );
      confidence += Math.floor(authorSimilarity * 20);
    }

    if (!metadata.coverImageUrl) {
      confidence -= 20;
    }

    confidence += this.getProviderConfidenceBonus();

    return Math.min(100, Math.max(0, confidence));
  }

  protected getProviderConfidenceBonus(): number {
    return 0;
  }

  protected calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  protected levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1,
          );
        }
      }
    }

    return matrix[str2.length]![str1.length]!;
  }

  protected cleanISBN(isbn: string): string {
    return isbn.replace(/[-\s]/g, '');
  }

  protected validateISBN(isbn: string): boolean {
    const cleanIsbn = this.cleanISBN(isbn);
    return /^\d{10}(\d{3})?$/.test(cleanIsbn);
  }
}
