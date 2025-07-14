export interface Metadata {
  title: string;
  subtitle?: string;
  author: string;
  publisher?: string;
  published?: string;
  language?: string;
  identifier?: string;
  subjects?: string[];
  description?: string;
  coverImageUrl?: string;
}

export interface SearchRequest {
  title?: string;
  isbn?: string;
  author?: string;
  language?: string;
}

export interface MetadataResult {
  metadata: Metadata;
  providerName: string;
  providerLabel: string;
  confidence: number;
}

export interface MetadataProvider {
  name: string;
  search(request: SearchRequest): Promise<MetadataResult[] | null>;
}
