import { useCallback, useRef, useState } from 'react';
import type { TextEditorRef } from '@/components/TextEditor';

/**
 * UI state for an inline text editor toggled by an edit icon: draft text,
 * edit-mode on/off, and start/cancel/save actions. Knows nothing about what
 * it's editing or how a save is persisted — `onSave` is the caller's own
 * save function (e.g. from `useSaveBooknoteNoteText`), so the same hook
 * serves any inline-edit surface (booknote text, bookmark text, and later
 * `AnnotationNotes`) without branching internally.
 */
export function useInlineTextEditor(
  onSave: (draftText: string) => void | boolean | Promise<void | boolean>,
) {
  const editorRef = useRef<TextEditorRef>(null);
  const [draftText, setDraftText] = useState('');
  const [inlineEditMode, setInlineEditMode] = useState(false);

  const startEdit = useCallback((initialText: string) => {
    setDraftText(initialText);
    setInlineEditMode(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setInlineEditMode(false);
  }, []);

  const save = useCallback(async () => {
    if ((await onSave(draftText)) !== false) setInlineEditMode(false);
  }, [draftText, onSave]);

  return { editorRef, draftText, setDraftText, inlineEditMode, startEdit, cancelEdit, save };
}
