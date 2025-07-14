import { stubTranslation as _ } from '@/utils/misc';
import { fetchWithTimeout } from '@/utils/fetch';
import { normalizedLangCode } from '@/utils/lang';
import { Metadata } from '../types';
import { BaseMetadataProvider } from './base';

interface GoogleBooksImageLinks {
  extraLarge?: string;
  large?: string;
  medium?: string;
  small?: string;
  thumbnail?: string;
  smallThumbnail?: string;
}

interface GoogleBooksVolume {
  title: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  language?: string;
  industryIdentifiers?: { type: string; identifier: string }[];
  imageLinks?: GoogleBooksImageLinks;
  categories?: string[];
  description?: string;
}

interface GoogleBooksItem {
  volumeInfo: GoogleBooksVolume;
}

export class GoogleBooksProvider extends BaseMetadataProvider {
  name = 'googlebooks';
  label = _('Google Books');
  private baseUrl = 'https://www.googleapis.com/books/v1';
  private apiKeys: string[];

  constructor(apiKeys: string) {
    super();

    if (!apiKeys) {
      throw new Error('Google Books API keys are required');
    }

    this.apiKeys = apiKeys.split(',').map((key) => key.trim());
  }

  protected override getProviderConfidenceBonus(): number {
    return 10;
  }

  private get apiKey(): string {
    return this.apiKeys[Math.floor(Math.random() * this.apiKeys.length)]!;
  }

  protected async searchByISBN(isbn: string): Promise<Metadata[]> {
    if (!this.validateISBN(isbn)) {
      throw new Error('Invalid ISBN format');
    }

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/volumes?q=isbn:${isbn}&key=${this.apiKey}`,
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Google Books API rate limit exceeded');
        }
        if (response.status === 403) {
          throw new Error('Google Books API access forbidden. Check your API key.');
        }
        throw new Error(`Google Books API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        return [];
      }

      return data.items
        .slice(0, this.maxResults)
        .map((item: GoogleBooksItem) => this.formatBookData(item.volumeInfo));
    } catch (error) {
      console.error('Google Books ISBN search failed:', error);
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
      let query = `intitle:${title.trim()}`;
      if (author && author.trim()) {
        query += `+inauthor:${author.trim()}`;
      }
      if (language && language.trim()) {
        query += `+language:${normalizedLangCode(language.trim())}`;
      }

      const response = await fetchWithTimeout(
        `${this.baseUrl}/volumes?q=${encodeURIComponent(query)}&key=${this.apiKey}`,
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Google Books API rate limit exceeded');
        }
        if (response.status === 403) {
          throw new Error('Google Books API access forbidden. Check your API key.');
        }
        throw new Error(`Google Books API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        return [];
      }

      return data.items
        .slice(0, this.maxResults)
        .map((item: GoogleBooksItem) => this.formatBookData(item.volumeInfo));
    } catch (error) {
      console.error('Google Books title search failed:', error);
      throw error;
    }
  }

  private formatBookData(book: GoogleBooksVolume): Metadata {
    return {
      title: book.title || '',
      subtitle: book.subtitle || '',
      author: this.formatAuthors(book.authors),
      publisher: book.publisher,
      published: book.publishedDate,
      language: book.language || 'en',
      identifier: this.extractISBN(book.industryIdentifiers),
      coverImageUrl: this.getCoverImage(book.imageLinks),
      subjects: book.categories || [],
      description: this.cleanDescription(book.description),
    };
  }

  private formatAuthors(authors: string[] | undefined): string {
    if (!authors || authors.length === 0) {
      return '';
    }

    if (authors.length === 1) {
      return authors[0]!;
    }

    if (authors.length === 2) {
      return authors.join(' & ');
    }

    return `${authors[0]} et al.`;
  }

  private extractISBN(
    identifiers: { type: string; identifier: string }[] | undefined,
  ): string | undefined {
    if (!identifiers || identifiers.length === 0) {
      return undefined;
    }

    const isbn13 = identifiers.find((id) => id.type === 'ISBN_13');
    if (isbn13) {
      return isbn13.identifier;
    }

    const isbn10 = identifiers.find((id) => id.type === 'ISBN_10');
    if (isbn10) {
      return isbn10.identifier;
    }

    return identifiers[0]!.identifier;
  }

  private getCoverImage(imageLinks?: GoogleBooksImageLinks): string | undefined {
    if (!imageLinks) {
      return undefined;
    }

    const coverUrl =
      imageLinks.extraLarge ||
      imageLinks.large ||
      imageLinks.medium ||
      imageLinks.small ||
      imageLinks.thumbnail ||
      imageLinks.smallThumbnail;

    return coverUrl ? coverUrl.replace('http:', 'https:') : undefined;
  }

  private cleanDescription(description: string | undefined): string | undefined {
    if (!description) {
      return undefined;
    }

    return description
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
