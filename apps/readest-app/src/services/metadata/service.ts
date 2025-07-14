import { MetadataProvider, SearchRequest, MetadataResult } from './types';
import { OpenLibraryProvider, GoogleBooksProvider } from './providers';

interface MetadataServiceConfig {
  googleBooksApiKeys?: string;
  providers?: MetadataProvider[];
}

export class MetadataService {
  private providers: MetadataProvider[] = [];

  constructor(config: MetadataServiceConfig = {}) {
    this.providers.push(new OpenLibraryProvider());

    if (config.googleBooksApiKeys) {
      this.providers.push(new GoogleBooksProvider(config.googleBooksApiKeys));
    }

    if (config.providers) {
      this.providers.push(...config.providers);
    }
  }

  async search(request: SearchRequest): Promise<MetadataResult[]> {
    const allResults: MetadataResult[] = [];

    const promises = this.providers.map(async (provider) => {
      try {
        const results = await provider.search(request);
        return results || [];
      } catch (error) {
        console.warn(`Provider ${provider.name} failed:`, error);
        return [];
      }
    });

    const responses = await Promise.allSettled(promises);

    responses.forEach((response) => {
      if (response.status === 'fulfilled') {
        allResults.push(...response.value);
      }
    });

    return allResults.sort((a, b) => b.confidence - a.confidence);
  }

  getProviders(): string[] {
    return this.providers.map((p) => p.name);
  }

  getProviderCount(): number {
    return this.providers.length;
  }
}
