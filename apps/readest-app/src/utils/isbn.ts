import { BookDoc } from '@/libs/document';
import { validateISBN } from '@/utils/validation';

export const extractIsbnCandidates = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractIsbnCandidates(entry));
  }

  if (typeof value === 'object') {
    const identifier = value as { scheme?: string; value?: string };
    const candidates = identifier.value ? extractIsbnCandidates(identifier.value) : [];
    if (identifier.scheme?.toLowerCase() === 'isbn' && identifier.value) {
      candidates.unshift(identifier.value);
    }
    return candidates;
  }

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const candidates = [trimmed];
  const prefixedMatches = trimmed.match(
    /(?:^|[\s,;])(?:urn:)?isbn:([0-9xX-]{10,17})(?=$|[\s,;])/gi,
  );
  if (prefixedMatches) {
    for (const match of prefixedMatches) {
      candidates.push(match.replace(/^[\s,;]+/, '').replace(/^(?:urn:)?isbn:/i, ''));
    }
  }

  return candidates;
};

export const normalizeMetadataIsbn = (metadata: BookDoc['metadata']) => {
  const existingIsbn = metadata.isbn ? validateISBN(metadata.isbn) : null;
  if (existingIsbn?.isValid && existingIsbn.value) {
    metadata.isbn = existingIsbn.value;
    return;
  }

  const candidates = [
    ...extractIsbnCandidates(metadata.identifier),
    ...extractIsbnCandidates(metadata.altIdentifier),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/^(?:urn:)?isbn:/i, '').trim();
    const validation = validateISBN(normalized);
    if (validation.isValid && validation.value) {
      metadata.isbn = validation.value;
      return;
    }
  }
};
