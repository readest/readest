import { describe, test, expect, beforeEach } from 'vitest';
import { useNotebookStore } from '@/store/notebookStore';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

beforeEach(() => {
  useNotebookStore.setState({
    notebookWidth: '',
    isNotebookVisible: false,
    isNotebookPinned: false,
    notebookActiveTab: 'notes',
    notebookNewAnnotation: null,
    notebookEditAnnotation: null,
    notebookAnnotationDrafts: {},
  });
});

describe('notebookStore', () => {
  // ── Visibility ─────────────────────────────────────────────────
  describe('toggleNotebook', () => {
    test('toggles visibility from false to true', () => {
      useNotebookStore.getState().toggleNotebook();
      expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    });

    test('toggles visibility from true to false', () => {
      useNotebookStore.getState().setNotebookVisible(true);
      useNotebookStore.getState().toggleNotebook();
      expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
    });
  });

  describe('setNotebookVisible', () => {
    test('sets visibility to true', () => {
      useNotebookStore.getState().setNotebookVisible(true);
      expect(useNotebookStore.getState().isNotebookVisible).toBe(true);
    });

    test('sets visibility to false', () => {
      useNotebookStore.getState().setNotebookVisible(true);
      useNotebookStore.getState().setNotebookVisible(false);
      expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
    });
  });

  describe('getIsNotebookVisible', () => {
    test('returns current visibility', () => {
      expect(useNotebookStore.getState().getIsNotebookVisible()).toBe(false);
      useNotebookStore.getState().setNotebookVisible(true);
      expect(useNotebookStore.getState().getIsNotebookVisible()).toBe(true);
    });
  });

  // ── Pin ────────────────────────────────────────────────────────
  describe('toggleNotebookPin', () => {
    test('toggles pin from false to true', () => {
      useNotebookStore.getState().toggleNotebookPin();
      expect(useNotebookStore.getState().isNotebookPinned).toBe(true);
    });

    test('toggles pin from true to false', () => {
      useNotebookStore.getState().setNotebookPin(true);
      useNotebookStore.getState().toggleNotebookPin();
      expect(useNotebookStore.getState().isNotebookPinned).toBe(false);
    });
  });

  describe('setNotebookPin', () => {
    test('sets pinned to true', () => {
      useNotebookStore.getState().setNotebookPin(true);
      expect(useNotebookStore.getState().isNotebookPinned).toBe(true);
    });

    test('sets pinned to false', () => {
      useNotebookStore.getState().setNotebookPin(true);
      useNotebookStore.getState().setNotebookPin(false);
      expect(useNotebookStore.getState().isNotebookPinned).toBe(false);
    });
  });

  // ── Width ──────────────────────────────────────────────────────
  describe('setNotebookWidth / getNotebookWidth', () => {
    test('sets and gets width', () => {
      useNotebookStore.getState().setNotebookWidth('400px');
      expect(useNotebookStore.getState().getNotebookWidth()).toBe('400px');
    });

    test('defaults to empty string', () => {
      expect(useNotebookStore.getState().getNotebookWidth()).toBe('');
    });
  });

  // ── Active tab ─────────────────────────────────────────────────
  describe('setNotebookActiveTab', () => {
    test('sets active tab to ai', () => {
      useNotebookStore.getState().setNotebookActiveTab('ai');
      expect(useNotebookStore.getState().notebookActiveTab).toBe('ai');
    });

    test('sets active tab to notes', () => {
      useNotebookStore.getState().setNotebookActiveTab('ai');
      useNotebookStore.getState().setNotebookActiveTab('notes');
      expect(useNotebookStore.getState().notebookActiveTab).toBe('notes');
    });

    test('defaults to notes', () => {
      expect(useNotebookStore.getState().notebookActiveTab).toBe('notes');
    });
  });

  // ── New annotation ─────────────────────────────────────────────
  describe('setNotebookNewAnnotation', () => {
    test('sets a new annotation selection', () => {
      const selection: TextSelection = {
        key: 'sel-1',
        text: 'Hello world',
        page: 1,
        range: new Range(),
        index: 0,
        cfi: 'epubcfi(/6/2!/4/1:0)',
      };
      useNotebookStore.getState().setNotebookNewAnnotation(selection);
      expect(useNotebookStore.getState().notebookNewAnnotation).toEqual(selection);
    });

    test('clears annotation when set to null', () => {
      const selection: TextSelection = {
        key: 'sel-1',
        text: 'test',
        page: 1,
        range: new Range(),
        index: 0,
      };
      useNotebookStore.getState().setNotebookNewAnnotation(selection);
      useNotebookStore.getState().setNotebookNewAnnotation(null);
      expect(useNotebookStore.getState().notebookNewAnnotation).toBeNull();
    });
  });

  // ── Edit annotation ────────────────────────────────────────────
  describe('setNotebookEditAnnotation', () => {
    test('sets a note for editing', () => {
      const note: BookNote = {
        id: 'note-1',
        type: 'annotation',
        cfi: 'epubcfi(/6/2)',
        note: 'My annotation',
        createdAt: 1000,
        updatedAt: 2000,
      };
      useNotebookStore.getState().setNotebookEditAnnotation(note);
      expect(useNotebookStore.getState().notebookEditAnnotation).toEqual(note);
    });

    test('clears edit annotation when set to null', () => {
      const note: BookNote = {
        id: 'note-1',
        type: 'bookmark',
        cfi: 'cfi',
        note: 'test',
        createdAt: 1000,
        updatedAt: 1000,
      };
      useNotebookStore.getState().setNotebookEditAnnotation(note);
      useNotebookStore.getState().setNotebookEditAnnotation(null);
      expect(useNotebookStore.getState().notebookEditAnnotation).toBeNull();
    });
  });

  // ── Annotation drafts ──────────────────────────────────────────
  describe('saveNotebookAnnotationDraft / getNotebookAnnotationDraft', () => {
    test('saves and retrieves a draft by key', () => {
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-1', 'Draft text');
      const draft = useNotebookStore.getState().getNotebookAnnotationDraft('note-1');
      expect(draft).toBe('Draft text');
    });

    test('returns undefined for non-existent key', () => {
      const draft = useNotebookStore.getState().getNotebookAnnotationDraft('unknown');
      expect(draft).toBeUndefined();
    });

    test('overwrites existing draft', () => {
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-1', 'First draft');
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-1', 'Updated draft');
      const draft = useNotebookStore.getState().getNotebookAnnotationDraft('note-1');
      expect(draft).toBe('Updated draft');
    });

    test('stores multiple drafts independently', () => {
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-1', 'Draft A');
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-2', 'Draft B');
      expect(useNotebookStore.getState().getNotebookAnnotationDraft('note-1')).toBe('Draft A');
      expect(useNotebookStore.getState().getNotebookAnnotationDraft('note-2')).toBe('Draft B');
    });

    test('preserves existing drafts when adding new ones', () => {
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-1', 'First');
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-2', 'Second');
      useNotebookStore.getState().saveNotebookAnnotationDraft('note-3', 'Third');

      const drafts = useNotebookStore.getState().notebookAnnotationDrafts;
      expect(Object.keys(drafts)).toHaveLength(3);
      expect(drafts['note-1']).toBe('First');
      expect(drafts['note-2']).toBe('Second');
      expect(drafts['note-3']).toBe('Third');
    });
  });

  // ── Initial state ──────────────────────────────────────────────
  describe('initial state', () => {
    test('has correct defaults', () => {
      const state = useNotebookStore.getState();
      expect(state.notebookWidth).toBe('');
      expect(state.isNotebookVisible).toBe(false);
      expect(state.isNotebookPinned).toBe(false);
      expect(state.notebookActiveTab).toBe('notes');
      expect(state.notebookNewAnnotation).toBeNull();
      expect(state.notebookEditAnnotation).toBeNull();
      expect(state.notebookAnnotationDrafts).toEqual({});
    });
  });
});
