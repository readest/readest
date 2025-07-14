import { stubTranslation as _ } from '@/utils/misc';
import { fetchWithTimeout } from '@/utils/fetch';
import { Metadata } from '../types';
import { BaseMetadataProvider } from './base';
import { code6392to6391, normalizedLangCode } from '@/utils/lang';

interface OpenLibraryBookSearch {
  title: string;
  author_name?: { name: string }[];
  publisher?: { name: string }[];
  first_publish_year?: string;
  language?: string[];
  isbn?: string[];
  cover_i?: number | string;
  subject?: string[];
  description?: string[];
}

interface OpenLibraryBookID {
  title: string;
  authors?: { name: string }[];
  publishers?: { name: string }[];
  publish_date?: string;
  languages?: { name: string }[];
  cover?: {
    small?: string;
    medium?: string;
    large?: string;
  };
  subjects?: { name: string }[];
  description?: string | { value: string };
}

export class OpenLibraryProvider extends BaseMetadataProvider {
  name = 'openlibrary';
  label = _('Open Library');
  private baseUrl = 'https://openlibrary.org';

  protected override getProviderConfidenceBonus(): number {
    return 0;
  }

  protected async searchByISBN(isbn: string): Promise<Metadata[]> {
    if (!this.validateISBN(isbn)) {
      throw new Error('Invalid ISBN format');
    }

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      );

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data = await response.json();
      const bookKey = `ISBN:${isbn}`;
      const book = data[bookKey];

      if (!book) {
        return [];
      }

      return [this.formatBookData(book, isbn)];
    } catch (error) {
      console.error('Open Library ISBN search failed:', error);
      throw error;
    }
  }

  protected async searchByTitle(
    title: string,
    author?: string,
    language?: string,
  ): Promise<Metadata[]> {
    if (!title || title.trim().length === 0) {
      throw new Error('Title is required');
    }

    try {
      let query = `title=${encodeURIComponent(title.trim())}`;
      if (author && author.trim()) {
        query += `&author=${encodeURIComponent(author.trim())}`;
      }
      if (language && language.trim()) {
        query += `&lang=${encodeURIComponent(normalizedLangCode(language.trim()))}`;
      }

      const response = await fetchWithTimeout(`${this.baseUrl}/search.json?${query}`);

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Open Library search results:', data);

      if (!data.docs || data.docs.length === 0) {
        return [];
      }

      return data.docs
        .map((doc: OpenLibraryBookSearch) => this.formatSearchResult(doc))
        .filter((metadata: Metadata) => (language ? metadata.language === language : true))
        .slice(0, this.maxResults);
    } catch (error) {
      console.error('Open Library title search failed:', error);
      throw error;
    }
  }

  private formatBookData(book: OpenLibraryBookID, isbn: string): Metadata {
    return {
      title: book.title || '',
      author: book.authors?.[0]?.name || '',
      publisher: book.publishers?.[0]?.name,
      published: book.publish_date,
      language: code6392to6391(book.languages?.[0]?.name || ''),
      identifier: isbn,
      coverImage: book.cover?.large || book.cover?.medium || book.cover?.small,
      subjects: book.subjects?.map((s: { name: string }) => s.name).slice(0, 5) || [],
      description: this.extractDescription(book.description || ''),
    } as Metadata;
  }

  private formatSearchResult(book: OpenLibraryBookSearch): Metadata {
    return {
      title: book.title || '',
      author: book.author_name?.[0] || '',
      publisher: book.publisher?.[0],
      published: book.first_publish_year?.toString(),
      language: code6392to6391(book.language?.[0] || ''),
      identifier: book.isbn?.[0],
      coverImageUrl: book.cover_i
        ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
        : undefined,
      subjects: book.subject?.slice(0, 5) || [],
      description: book.description?.[0],
    } as Metadata;
  }

  private extractDescription(description: string | { value: string }): string | undefined {
    if (!description) return undefined;

    if (typeof description === 'string') {
      return description;
    }

    if (description.value) {
      return description.value;
    }

    return undefined;
  }
}
