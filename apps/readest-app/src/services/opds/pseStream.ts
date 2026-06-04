import type { BookFormat } from '@/types/book';
import type { BookDoc } from '@/libs/document';

export const PSE_SCHEME = 'pse://';

export interface PseStreamData {
  url: string;
  catalogId: string;
  count: number;
  title: string;
  author: string;
}

export const isPseStreamFileName = (name: string): boolean => name.startsWith(PSE_SCHEME);

export const buildPseStreamFileName = (data: PseStreamData): string =>
  PSE_SCHEME + encodeURIComponent(JSON.stringify(data));

export const parsePseStreamFileName = (name: string): PseStreamData =>
  JSON.parse(decodeURIComponent(name.replace(PSE_SCHEME, '')));

export const createPseStreamPageLoader = (data: PseStreamData) => {
  return async (): Promise<Blob> => {
    throw new Error(`OPDS PSE streams are disabled in this local-only build: ${data.title}`);
  };
};

export const openPseStreamBook = async (
  data: PseStreamData,
): Promise<{ book: BookDoc; format: BookFormat }> => {
  throw new Error(`OPDS PSE streams are disabled in this local-only build: ${data.title}`);
};
