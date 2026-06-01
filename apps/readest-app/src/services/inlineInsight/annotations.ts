import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';
import { uniqueId } from '@/utils/misc';

export const INLINE_INSIGHT_UNDERLINE_COLOR = '#9ca3af';

export interface InlineInsightSnapshot {
  answer: string;
  context: string;
}

export function isInlineInsightAnnotation(note?: Pick<BookNote, 'inlineInsight'> | null): boolean {
  return Boolean(note?.inlineInsight);
}

export function isUserBookNote(note: BookNote): boolean {
  return !note.inlineInsight;
}

export function isRegularTextAnnotation(note: BookNote): boolean {
  return (
    note.type === 'annotation' &&
    Boolean(note.style) &&
    !note.deletedAt &&
    !isInlineInsightAnnotation(note)
  );
}

export function isSyncableBookNote(note: BookNote): boolean {
  return (
    (note.type === 'annotation' || note.type === 'excerpt') &&
    !note.deletedAt &&
    isUserBookNote(note)
  );
}

export function upsertInlineInsightAnnotation(
  annotations: BookNote[],
  selection: TextSelection,
  cfi: string,
  snapshot: InlineInsightSnapshot,
): {
  annotation: BookNote;
  previousAnnotation?: BookNote;
  updatedAnnotations: BookNote[];
} {
  const existingIndex = annotations.findIndex(
    (annotation) =>
      annotation.type === 'annotation' &&
      annotation.cfi === cfi &&
      isInlineInsightAnnotation(annotation) &&
      !annotation.deletedAt,
  );
  const previousAnnotation = existingIndex === -1 ? undefined : annotations[existingIndex];
  const now = Date.now();
  const annotation: BookNote = {
    id: previousAnnotation?.id ?? uniqueId(),
    type: 'annotation',
    cfi,
    style: 'underline',
    color: INLINE_INSIGHT_UNDERLINE_COLOR,
    text: selection.text,
    note: '',
    page: selection.page,
    inlineInsight: snapshot,
    createdAt: previousAnnotation?.createdAt ?? now,
    updatedAt: now,
  };

  const updatedAnnotations =
    existingIndex === -1
      ? [...annotations, annotation]
      : annotations.map((item, index) => (index === existingIndex ? annotation : item));

  return { annotation, previousAnnotation, updatedAnnotations };
}
