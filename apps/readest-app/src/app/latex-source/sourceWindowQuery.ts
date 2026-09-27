import type { SelectionContext } from '@/store/notebookStore';

export interface SourceWindowRequest {
  request: SelectionContext;
  readerWindowLabel: string;
}

export const buildLatexSourceWindowUrl = (request: SelectionContext, readerWindowLabel: string) => {
  const params = new URLSearchParams({
    request: JSON.stringify(request),
    readerWindowLabel,
  });
  return `/latex-source?${params.toString()}`;
};

const isSelectionContext = (value: unknown): value is SelectionContext => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<SelectionContext>;
  return (
    typeof request.id === 'string' &&
    typeof request.bookKey === 'string' &&
    typeof request.text === 'string' &&
    typeof request.page === 'number' &&
    typeof request.index === 'number'
  );
};

export const parseLatexSourceWindowQuery = (query: string): SourceWindowRequest | null => {
  const params = new URLSearchParams(query);
  const serialized = params.get('request');
  const readerWindowLabel = params.get('readerWindowLabel');
  if (!serialized || !readerWindowLabel) return null;
  try {
    const request = JSON.parse(serialized);
    return isSelectionContext(request) ? { request, readerWindowLabel } : null;
  } catch {
    return null;
  }
};
