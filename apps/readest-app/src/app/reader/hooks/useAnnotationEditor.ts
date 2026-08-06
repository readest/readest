import { useCallback, useRef, useState } from 'react';
import { BookNote } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';
import { TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  getHandlePositionsFromRange as getHandlePositionsForBook,
  HandlePositions,
  removeBookNoteOverlays,
} from '../utils/annotatorUtil';

interface UseAnnotationEditorProps {
  bookKey: string;
  annotation: BookNote;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
}

export const useAnnotationEditor = ({
  bookKey,
  annotation,
  getAnnotationText,
  setSelection,
}: UseAnnotationEditorProps) => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getProgress, getViewsById } = useReaderStore();

  const view = getView(bookKey);
  const editingAnnotationRef = useRef(annotation);
  const [handlePositions, setHandlePositions] = useState<HandlePositions | null>(null);

  const getHandlePositionsFromRange = useCallback(
    (range: Range, isVertical: boolean): HandlePositions | null =>
      getHandlePositionsForBook(bookKey, range, isVertical),
    [bookKey],
  );

  // Apply an already-built range (anchored at the non-dragged end in the editor
  // component so it survives a corner auto page-turn) to the edited annotation.
  const applyAnnotationRange = useCallback(
    async (newRange: Range, targetIndex: number, isVertical: boolean, isDragging: boolean) => {
      if (!editingAnnotationRef.current || !view) return;

      const newPositions = getHandlePositionsFromRange(newRange, isVertical);
      if (newPositions) {
        setHandlePositions(newPositions);
      }

      const newCfi = view.getCFI(targetIndex, newRange);
      const newText = await getAnnotationText(newRange);

      if (newCfi && newText) {
        const config = getConfig(bookKey)!;
        const progress = getProgress(bookKey)!;
        const { booknotes: annotations = [] } = config;
        const existingIndex = annotations.findIndex(
          (a) => a.id === editingAnnotationRef.current.id && !a.deletedAt,
        );

        if (existingIndex !== -1) {
          const existingAnnotation = annotations[existingIndex]!;
          const updatedAnnotation: BookNote = {
            ...existingAnnotation,
            cfi: newCfi,
            text: newText,
            updatedAt: Date.now(),
          };

          // Both overlays of a unified record are keyed by its cfi, so a moved
          // range must tear down *both* — dropping only the highlight left the
          // note bubble stranded at the old anchor while a new one was drawn at
          // the new one, so one highlight showed several note markers (#5538).
          const views = getViewsById(bookKey.split('-')[0]!);
          const hasNote = !!existingAnnotation.note?.trim();
          views.forEach((v) => removeBookNoteOverlays(v, editingAnnotationRef.current));
          views.forEach((v) => v?.addAnnotation(updatedAnnotation));
          if (hasNote) {
            views.forEach((v) =>
              v?.addAnnotation({ ...updatedAnnotation, value: `${NOTE_PREFIX}${newCfi}` }),
            );
          }
          editingAnnotationRef.current = updatedAnnotation;

          if (!isDragging) {
            annotations[existingIndex] = updatedAnnotation;
            const updatedConfig = updateBooknotes(bookKey, annotations);
            if (updatedConfig) {
              saveConfig(envConfig, bookKey, updatedConfig, settings);
            }

            setSelection({
              key: bookKey,
              annotated: true,
              text: newText,
              cfi: newCfi,
              index: targetIndex,
              range: newRange,
              page: existingAnnotation.page || progress.page,
            });
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, getHandlePositionsFromRange, getAnnotationText, setSelection],
  );

  return {
    handlePositions,
    setHandlePositions,
    getHandlePositionsFromRange,
    applyAnnotationRange,
  };
};
