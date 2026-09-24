'use client';

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import type { Book } from '@/types/book';
import {
  parseLibrarySourceDocument,
  type HtmlImportMode,
  type SourceDocumentWarning,
  type TxtEncoding,
} from '@/services/foundation/sourceDocumentAdapter';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
  type SourceDocAnchor,
  type SourceDocCitation,
  type SourceDocFixture,
  type SourceDocThread,
} from '@/services/foundation/sourceDocSpike';

const READING_SETTINGS_KEY = 'readest:foundation-spike:reading-settings:v1';
const SOURCE_PREFERENCES_KEY = 'readest:foundation-spike:source-preferences:v1';

interface ReadingSettings {
  contentWidth: number;
  sidebarWidth: number;
  fontSize: number;
  lineHeight: number;
  annotationDisplay: 'underline' | 'card' | 'both';
  toolbarPinned: boolean;
}

const DEFAULT_READING_SETTINGS: ReadingSettings = {
  contentWidth: 720,
  sidebarWidth: 400,
  fontSize: 18,
  lineHeight: 1.75,
  annotationDisplay: 'both',
  toolbarPinned: false,
};

const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const ANNOTATION_HIGHLIGHT = 'foundation-annotations';
const ACTIVE_ANNOTATION_HIGHLIGHT = 'foundation-active-annotation';
const CITATION_HIGHLIGHT = 'foundation-citation';
const SELECTION_HIGHLIGHT = 'foundation-selection';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

interface WindowDimensions {
  width: number;
  height: number;
}

export function restoredWindowSize(
  savedSize: WindowDimensions | null,
  workArea: WindowDimensions | null,
): WindowDimensions {
  const fallbackSize = workArea
    ? {
        width: Math.round(workArea.width * 0.75),
        height: Math.round(workArea.height * 0.75),
      }
    : { width: 2160, height: 1350 };
  const requestedSize = savedSize ?? fallbackSize;
  return workArea
    ? {
        width: Math.min(requestedSize.width, workArea.width),
        height: Math.min(requestedSize.height, workArea.height),
      }
    : requestedSize;
}

function textBoundary(element: HTMLElement, offset: number): [Node, number] | null {
  const walker = globalThis.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let lastNode: Text | null = null;
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastNode = textNode;
    const next = consumed + textNode.data.length;
    if (offset <= next) return [textNode, Math.max(0, offset - consumed)];
    consumed = next;
  }
  return lastNode ? [lastNode, lastNode.data.length] : null;
}

function domRange(element: HTMLElement, start: number, end: number): Range | null {
  const startBoundary = textBoundary(element, start);
  const endBoundary = textBoundary(element, end);
  if (!startBoundary || !endBoundary || end <= start) return null;
  const range = globalThis.document.createRange();
  range.setStart(...startBoundary);
  range.setEnd(...endBoundary);
  return range;
}

export default function FoundationSpike() {
  const { appService } = useEnv();
  const libraryBookId =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('book');
  const [documentModel, setDocumentModel] = useState<SourceDocFixture>(SOURCE_DOC_FIXTURE);
  const [anchor, setAnchor] = useState<SourceDocAnchor | null>(null);
  const [threads, setThreads] = useState<SourceDocThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [annotationManagerOpen, setAnnotationManagerOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [highlightedCitation, setHighlightedCitation] = useState<SourceDocCitation | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [selectionPreview, setSelectionPreview] = useState('');
  const [, setSelectionAttachments] = useState<string[]>([]);
  const [questionAttachments, setQuestionAttachments] = useState<string[]>([]);
  const [selectedAnchors, setSelectedAnchors] = useState<SourceDocAnchor[]>([]);
  const [attachSelection, setAttachSelection] = useState(false);
  const [annotationPickerBlockId, setAnnotationPickerBlockId] = useState<string | null>(null);
  const [previewedThreadId, setPreviewedThreadId] = useState<string | null>(null);
  const [expandedAttachmentIds, setExpandedAttachmentIds] = useState<string[]>([]);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [navigationStatus, setNavigationStatus] = useState('');
  const [importError, setImportError] = useState('');
  const [sourceWarnings, setSourceWarnings] = useState<SourceDocumentWarning[]>([]);
  const [libraryBook, setLibraryBook] = useState<Book | null>(null);
  const [libraryFile, setLibraryFile] = useState<File | null>(null);
  const [txtEncoding, setTxtEncoding] = useState<TxtEncoding>('utf-8');
  const [htmlMode, setHtmlMode] = useState<HtmlImportMode>('article');
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [readingSettings, setReadingSettings] = useState(DEFAULT_READING_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<string[]>([]);
  const [showUnanchoredOnly, setShowUnanchoredOnly] = useState(false);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarDrag = useRef<{ startX: number; startWidth: number } | null>(null);
  const sourcePointerStart = useRef<{ x: number; y: number } | null>(null);
  const normalWindowSize = useRef<{ width: number; height: number } | null>(null);
  const toolbarExpanded = readingSettings.toolbarPinned || toolbarHovered;
  const store = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : new SourceDocSpikeStore(
            window.localStorage,
            libraryBookId ? `library:${libraryBookId}` : undefined,
          ),
    [libraryBookId],
  );

  const refreshThreads = (preferredId?: string | null) => {
    if (!store) return;
    const nextThreads = store.listThreads();
    setThreads(nextThreads);
    const nextId = preferredId ?? activeThreadId ?? nextThreads[0]?.id ?? null;
    setActiveThreadId(nextThreads.some((item) => item.id === nextId) ? nextId : null);
  };

  useEffect(() => {
    if (!store) return;
    const currentDocument = store.loadCurrentDocument();
    const restored = store.load();
    setDocumentModel(currentDocument);
    setThreads(store.listThreads());
    setActiveThreadId(restored?.id ?? null);
    setAnchor(restored?.unanchored ? null : (restored?.anchor ?? null));
    setSelectedAnchors(restored?.unanchored || !restored?.anchor ? [] : [restored.anchor]);
    setSelectionPreview(restored?.unanchored ? '' : (restored?.anchor?.exactQuote ?? ''));
    setSelectionAttachments(
      restored?.unanchored || !restored?.anchor ? [] : [restored.anchor.exactQuote],
    );
    try {
      const savedSettings = window.localStorage.getItem(READING_SETTINGS_KEY);
      if (savedSettings) {
        setReadingSettings({ ...DEFAULT_READING_SETTINGS, ...JSON.parse(savedSettings) });
      }
    } catch {
      window.localStorage.removeItem(READING_SETTINGS_KEY);
    }
  }, [store]);

  useEffect(() => {
    if (!appService || !store || !libraryBookId) return;
    let cancelled = false;
    const loadLibraryBook = async () => {
      try {
        const book = (await appService.loadLibraryBooks()).find(
          (candidate) => candidate.hash === libraryBookId && !candidate.deletedAt,
        );
        if (!book) throw new Error('书库中找不到这本书');
        const { file } = await appService.loadBookContent(book);
        let preferences: {
          txtEncoding?: TxtEncoding;
          htmlMode?: HtmlImportMode;
          allowRemoteImages?: boolean;
        } = {};
        try {
          const saved = JSON.parse(window.localStorage.getItem(SOURCE_PREFERENCES_KEY) ?? '{}');
          preferences = saved[book.hash] ?? {};
        } catch {}
        const result = await parseLibrarySourceDocument(book, file, preferences);
        if (cancelled) return;
        const imported = store.importDocument(result.document);
        setLibraryBook(book);
        setLibraryFile(file);
        setTxtEncoding(result.txtEncoding ?? preferences.txtEncoding ?? 'utf-8');
        setHtmlMode(result.htmlMode ?? preferences.htmlMode ?? 'article');
        setAllowRemoteImages(preferences.allowRemoteImages ?? false);
        setSourceWarnings(result.warnings);
        setDocumentModel(imported);
        setAnchor(null);
        setActiveThreadId(null);
        setHighlightedCitation(null);
        setImportError('');
        refreshThreads(null);
      } catch (error) {
        if (!cancelled) {
          setImportError(error instanceof Error ? error.message : '无法从书库打开此文档');
        }
      }
    };
    void loadLibraryBook();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, libraryBookId, store]);

  const saveSourcePreferences = (next: {
    txtEncoding?: TxtEncoding;
    htmlMode?: HtmlImportMode;
    allowRemoteImages?: boolean;
  }) => {
    if (!libraryBook) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(SOURCE_PREFERENCES_KEY) ?? '{}');
      saved[libraryBook.hash] = { ...(saved[libraryBook.hash] ?? {}), ...next };
      window.localStorage.setItem(SOURCE_PREFERENCES_KEY, JSON.stringify(saved));
    } catch {}
  };

  const reparseLibraryDocument = async (next: {
    txtEncoding?: TxtEncoding;
    htmlMode?: HtmlImportMode;
    allowRemoteImages?: boolean;
  }) => {
    if (!store || !libraryBook || !libraryFile) return;
    try {
      const options = { txtEncoding, htmlMode, allowRemoteImages, ...next };
      const result = await parseLibrarySourceDocument(libraryBook, libraryFile, options);
      setDocumentModel(store.importDocument(result.document));
      setSourceWarnings(result.warnings);
      setImportError('');
      if (result.txtEncoding) setTxtEncoding(result.txtEncoding);
      if (result.htmlMode) setHtmlMode(result.htmlMode);
      if (next.allowRemoteImages !== undefined) setAllowRemoteImages(next.allowRemoteImages);
      saveSourcePreferences(next);
      refreshThreads(activeThreadId);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法重新解析此文档');
    }
  };

  useEffect(() => {
    const updateProgress = () => {
      const reader = readerScrollRef.current;
      if (!reader) return;
      const scrollable = reader.scrollHeight - reader.clientHeight;
      setReadingProgress(
        scrollable > 0 ? Math.min(100, Math.max(0, (reader.scrollTop / scrollable) * 100)) : 0,
      );
    };
    const reader = readerScrollRef.current;
    updateProgress();
    reader?.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    return () => {
      reader?.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, [documentModel, readingSettings, sidebarOpen]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!sidebarDrag.current) return;
      const width = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          sidebarDrag.current.startWidth + sidebarDrag.current.startX - event.clientX,
        ),
      );
      updateReadingSetting('sidebarWidth', width);
    };
    const onPointerUp = () => {
      sidebarDrag.current = null;
      globalThis.document.body.style.removeProperty('cursor');
      globalThis.document.body.style.removeProperty('user-select');
    };
    globalThis.addEventListener('pointermove', onPointerMove);
    globalThis.addEventListener('pointerup', onPointerUp);
    return () => {
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerup', onPointerUp);
    };
  });

  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;
  const selectedThread =
    selectedThreadIds.length === 1
      ? (threads.find((item) => item.id === selectedThreadIds[0]) ?? null)
      : null;
  const visibleThreads = threads.filter(
    (item) =>
      (!showUnanchoredOnly || item.unanchored) &&
      (!search.trim() ||
        `${item.title} ${item.anchor?.exactQuote ?? ''} ${item.messages.map((message) => message.content).join(' ')}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const threadsByBlock = new Map<string, SourceDocThread[]>();
  const markerThreadsByBlock = new Map<string, SourceDocThread[]>();
  for (const item of threads) {
    if (item.unanchored) continue;
    markerThreadsByBlock.set(item.anchor.blockId, [
      ...(markerThreadsByBlock.get(item.anchor.blockId) ?? []),
      item,
    ]);
    for (const blockId of item.anchor.selectedBlockIds) {
      threadsByBlock.set(blockId, [...(threadsByBlock.get(blockId) ?? []), item]);
    }
  }

  const captureSelection = (event: ReactMouseEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const sourceTexts = Array.from(
      globalThis.document.querySelectorAll<HTMLElement>('[data-source-text]'),
    );
    const intersectedTexts = sourceTexts.filter((element) => range.intersectsNode(element));
    const startText =
      startElement?.closest<HTMLElement>('[data-source-text]') ?? intersectedTexts[0];
    const endText =
      endElement?.closest<HTMLElement>('[data-source-text]') ?? intersectedTexts.at(-1);
    const startBlockId = startText?.dataset['sourceText'];
    const endBlockId = endText?.dataset['sourceText'];
    if (!startText || !endText || !startBlockId || !endBlockId) {
      setSelectionError('请选择左侧编号源块中的连续文字。');
      return;
    }
    const offsetWithin = (element: HTMLElement, container: Node, offset: number) => {
      const prefix = globalThis.document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    };
    try {
      const nextAnchor = createRangeAnchor(
        documentModel,
        startBlockId,
        startText.contains(range.startContainer)
          ? offsetWithin(startText, range.startContainer, range.startOffset)
          : 0,
        endBlockId,
        endText.contains(range.endContainer)
          ? offsetWithin(endText, range.endContainer, range.endOffset)
          : (endText.textContent?.length ?? 0),
      );
      const nextText = selection.toString().trim();
      if (attachSelection) {
        if (nextText) setQuestionAttachments((current) => [...current, nextText]);
        setAttachSelection(false);
        setSelectionError('');
        return;
      }
      setAnchor(nextAnchor);
      setSelectedAnchors((current) => (event.ctrlKey ? [...current, nextAnchor] : [nextAnchor]));
      setSelectionAttachments((current) =>
        event.ctrlKey && current.length > 0 ? [...current, nextText] : [nextText],
      );
      setSelectionPreview((current) =>
        event.ctrlKey && current ? `${current}\n${nextText}` : nextText,
      );
      setActiveThreadId(null);
      setSelectionError('');
    } catch {
      setSelectionError('选区无法建立锚点，请从前向后选择连续正文。');
    }
  };

  const ask = () => {
    if (!store || !question.trim()) return;
    const updated = store.ask(
      documentModel,
      anchor,
      question.trim(),
      activeThreadId ?? undefined,
      questionAttachments.length > 0 ? questionAttachments.join('\n') : undefined,
    );
    setQuestion('');
    setQuestionAttachments([]);
    refreshThreads(updated.id);
    requestAnimationFrame(() => {
      const conversation = conversationScrollRef.current;
      conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' });
    });
  };

  const selectThread = (thread: SourceDocThread) => {
    setActiveThreadId(thread.id);
    setAnchor(thread.unanchored ? null : thread.anchor);
    setSelectedAnchors(thread.unanchored ? [] : [thread.anchor]);
    setSelectionPreview(thread.unanchored ? '' : thread.anchor.exactQuote);
    setSelectionAttachments(thread.unanchored ? [] : [thread.anchor.exactQuote]);
    setAnnotationPickerBlockId(null);
    setSidebarOpen(true);
    setAnnotationManagerOpen(false);
    if (!thread.unanchored) {
      globalThis.document
        .querySelector(`[data-block-id="${thread.anchor.blockId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const navigateToCitation = (citation: SourceDocCitation) => {
    setHighlightedCitation(citation);
    globalThis.document
      .querySelector(`[data-block-id="${citation.blockId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setNavigationStatus(`已定位到${blockLabel(citation.blockId)}`);
  };

  const importMarkdown = async (file: File | undefined) => {
    if (!file || !store) return;
    try {
      const imported = store.importMarkdown(file.name, await file.text());
      setDocumentModel(imported);
      setAnchor(null);
      setActiveThreadId(null);
      setHighlightedCitation(null);
      setImportError('');
      setSourceWarnings([]);
      refreshThreads(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Markdown 导入失败');
    }
  };

  const renameActiveThread = () => {
    const targetThread = selectedThread ?? activeThread;
    if (!store || !targetThread) return;
    store.renameThread(targetThread.id, titleDraft);
    setEditingTitle(false);
    refreshThreads(activeThreadId);
  };

  const saveMessage = () => {
    if (!store || !editingMessageId || !messageDraft.trim()) return;
    store.editMessage(editingMessageId, messageDraft);
    setEditingMessageId(null);
    setMessageDraft('');
    refreshThreads(activeThreadId);
  };

  const cancelMessageEdit = () => {
    setEditingMessageId(null);
    setMessageDraft('');
  };

  const clearSelection = () => {
    setAnchor(null);
    setSelectionPreview('');
    setSelectionAttachments([]);
    setSelectedAnchors([]);
    setActiveThreadId(null);
    setSelectionError('');
    setAnnotationPickerBlockId(null);
    window.getSelection()?.removeAllRanges();
  };

  const deleteSelectedThreads = () => {
    if (!store || selectedThreadIds.length === 0) return;
    store.deleteThreads(selectedThreadIds);
    const removedActiveThread = activeThreadId ? selectedThreadIds.includes(activeThreadId) : false;
    setSelectedThreadIds([]);
    if (removedActiveThread) setAnchor(null);
    refreshThreads(removedActiveThread ? null : activeThreadId);
  };

  const toggleThreadSelection = (threadId: string) => {
    setSelectedThreadIds((current) =>
      current.includes(threadId)
        ? current.filter((selectedId) => selectedId !== threadId)
        : [...current, threadId],
    );
  };

  const updateReadingSetting = (key: keyof ReadingSettings, value: number) => {
    setReadingSettings((current) => {
      const nextSettings = { ...current, [key]: value };
      window.localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify(nextSettings));
      return nextSettings;
    });
  };

  const updateToolbarPinned = (pinned: boolean) => {
    setReadingSettings((current) => {
      const nextSettings = { ...current, toolbarPinned: pinned };
      window.localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify(nextSettings));
      return nextSettings;
    });
  };

  const jumpToProgress = (value: number) => {
    const reader = readerScrollRef.current;
    if (!reader) return;
    const scrollable = reader.scrollHeight - reader.clientHeight;
    setReadingProgress(value);
    reader.scrollTo({ top: (scrollable * value) / 100, behavior: 'smooth' });
  };

  const startWindowDragging = async (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || windowFullscreen) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, label, select, a')) return;
    try {
      if (isTauriAppPlatform()) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        if (await currentWindow.isFullscreen()) return;
        await currentWindow.startDragging();
      }
    } catch {
      // Window dragging is only available in the desktop shell.
    }
  };

  const minimizeWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {
      // Window controls are only available in the desktop shell.
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (isTauriAppPlatform()) {
        const { currentMonitor, getCurrentWindow, LogicalSize } = await import(
          '@tauri-apps/api/window'
        );
        const currentWindow = getCurrentWindow();
        if (await currentWindow.isFullscreen()) {
          setWindowFullscreen(false);
          await currentWindow.setFullscreen(false);
          await currentWindow.unmaximize();
          const monitor = await currentMonitor();
          const workArea = monitor?.workArea.size.toLogical(monitor.scaleFactor);
          const size = restoredWindowSize(normalWindowSize.current, workArea ?? null);
          await currentWindow.setSize(new LogicalSize(size.width, size.height));
          await currentWindow.center();
        } else {
          const maximized = await currentWindow.isMaximized();
          if (maximized) {
            normalWindowSize.current = null;
            await currentWindow.unmaximize();
          } else {
            const factor = await currentWindow.scaleFactor();
            const currentSize = await currentWindow.innerSize();
            normalWindowSize.current = {
              width: Math.round(currentSize.width / factor),
              height: Math.round(currentSize.height / factor),
            };
          }
          await currentWindow.setFullscreen(true);
          setWindowFullscreen(true);
        }
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setWindowFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setWindowFullscreen(true);
      }
    } catch {
      // Fullscreen is optional in restricted webviews.
    }
  };

  const closeWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  const blockLabel = (blockId: string) => {
    const index = documentModel.blocks.findIndex((item) => item.id === blockId);
    return `源块 ${String(index + 1).padStart(2, '0')}`;
  };
  const sectionLabel = (blockId: string) => {
    const block = documentModel.blocks.find((item) => item.id === blockId);
    return documentModel.sections.find((item) => item.id === block?.sectionId)?.title ?? '';
  };
  useLayoutEffect(() => {
    const css = globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry };
    const HighlightClass = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor })
      .Highlight;
    if (!css.highlights || !HighlightClass) return;
    const annotationRanges: Range[] = [];
    const activeAnnotationRanges: Range[] = [];
    const selectionRanges: Range[] = [];
    for (const thread of threads) {
      if (thread.unanchored) continue;
      if (readingSettings.annotationDisplay === 'card') continue;
      for (const blockId of thread.anchor.selectedBlockIds) {
        const element = globalThis.document.querySelector<HTMLElement>(
          `[data-source-text="${blockId}"]`,
        );
        if (!element) continue;
        const blockPosition = thread.anchor.selectedBlockIds.indexOf(blockId);
        const range = domRange(
          element,
          blockPosition === 0 ? thread.anchor.startOffset : 0,
          blockPosition === thread.anchor.selectedBlockIds.length - 1
            ? thread.anchor.endOffset
            : (element.textContent?.length ?? 0),
        );
        if (range) {
          annotationRanges.push(range);
          if (thread.id === activeThreadId || thread.id === previewedThreadId) {
            activeAnnotationRanges.push(range.cloneRange());
          }
        }
      }
    }
    for (const selectedAnchor of selectedAnchors) {
      for (const blockId of selectedAnchor.selectedBlockIds) {
        const element = globalThis.document.querySelector<HTMLElement>(
          `[data-source-text="${blockId}"]`,
        );
        if (!element) continue;
        const blockPosition = selectedAnchor.selectedBlockIds.indexOf(blockId);
        const range = domRange(
          element,
          blockPosition === 0 ? selectedAnchor.startOffset : 0,
          blockPosition === selectedAnchor.selectedBlockIds.length - 1
            ? selectedAnchor.endOffset
            : (element.textContent?.length ?? 0),
        );
        if (range) selectionRanges.push(range);
      }
    }
    css.highlights.set(ANNOTATION_HIGHLIGHT, new HighlightClass(...annotationRanges));
    css.highlights.set(ACTIVE_ANNOTATION_HIGHLIGHT, new HighlightClass(...activeAnnotationRanges));
    css.highlights.set(SELECTION_HIGHLIGHT, new HighlightClass(...selectionRanges));
    css.highlights.delete(CITATION_HIGHLIGHT);
    if (highlightedCitation) {
      const element = globalThis.document.querySelector<HTMLElement>(
        `[data-source-text="${highlightedCitation.blockId}"]`,
      );
      const start = element?.textContent?.indexOf(highlightedCitation.exactQuote) ?? -1;
      const range = element
        ? domRange(element, start, start + highlightedCitation.exactQuote.length)
        : null;
      if (range) css.highlights.set(CITATION_HIGHLIGHT, new HighlightClass(range));
    }
    return () => {
      css.highlights?.delete(ANNOTATION_HIGHLIGHT);
      css.highlights?.delete(ACTIVE_ANNOTATION_HIGHLIGHT);
      css.highlights?.delete(CITATION_HIGHLIGHT);
      css.highlights?.delete(SELECTION_HIGHLIGHT);
    };
  });

  const openThreadAtPointer = (
    event: ReactMouseEvent<HTMLElement>,
    blockThreads: SourceDocThread[],
  ) => {
    const sourceText = event.currentTarget;
    const blockId = sourceText?.dataset['sourceText'];
    const pointerStart = sourcePointerStart.current;
    sourcePointerStart.current = null;
    if (!sourceText || !blockId) return;
    if (
      pointerStart &&
      (Math.abs(event.clientX - pointerStart.x) > 4 || Math.abs(event.clientY - pointerStart.y) > 4)
    )
      return;
    const documentWithCaret = globalThis.document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const caretPosition = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
    const caretRange = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
    const selection = window.getSelection();
    const node = caretPosition?.offsetNode ?? caretRange?.startContainer ?? selection?.focusNode;
    const nodeOffset = caretPosition?.offset ?? caretRange?.startOffset ?? selection?.focusOffset;
    let offset: number | null = null;
    if (node && nodeOffset !== undefined && sourceText.contains(node)) {
      const prefix = globalThis.document.createRange();
      prefix.selectNodeContents(sourceText);
      prefix.setEnd(node, nodeOffset);
      offset = prefix.toString().length;
    }
    const matching = blockThreads.filter((thread) => {
      if (!thread.anchor) return false;
      if (offset === null) return true;
      const position = thread.anchor.selectedBlockIds.indexOf(blockId);
      const start = position === 0 ? thread.anchor.startOffset : 0;
      const end =
        position === thread.anchor.selectedBlockIds.length - 1
          ? thread.anchor.endOffset
          : (sourceText.textContent?.length ?? 0);
      return offset >= start && offset <= end;
    });
    const preferred = matching.find((thread) => thread.status === 'active') ?? matching[0];
    if (preferred) selectThread(preferred);
  };

  const surface = dark ? '#111827' : '#f3f4f6';
  const panel = dark ? '#1f2937' : '#ffffff';
  const mutedPanel = dark ? '#374151' : '#e5e7eb';
  const foreground = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#d1d5db' : '#4b5563';

  const markdownComponents = {
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className='mb-4 text-[1.55em] font-bold leading-tight'>{children}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className='mb-3 mt-7 text-[1.35em] font-bold leading-tight'>{children}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className='mb-2 mt-6 text-[1.18em] font-semibold leading-tight'>{children}</h3>
    ),
    p: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className='my-2 border-l-4 border-blue-500/40 pl-4 italic'>{children}</blockquote>
    ),
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className='my-2 list-disc space-y-1 pl-6'>{children}</ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className='my-2 list-decimal space-y-1 pl-6'>{children}</ol>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <div className='my-2 overflow-x-auto'>
        <table className='w-full border-collapse text-left text-[0.9em]'>{children}</table>
      </div>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className='border px-3 py-2 font-semibold'>{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className='border px-3 py-2'>{children}</td>
    ),
    pre: ({ children }: { children?: ReactNode }) => (
      <pre
        className='my-2 overflow-x-auto whitespace-pre-wrap rounded-md px-3 py-2 font-mono text-[0.88em]'
        style={{ backgroundColor: mutedPanel }}
      >
        {children}
      </pre>
    ),
    code: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <code className={className}>
        {className ? String(children).replace(/\n$/, '') : children}
      </code>
    ),
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a
        className='text-blue-600 underline underline-offset-2'
        href={href}
        target='_blank'
        rel='noopener noreferrer'
      >
        {children}
      </a>
    ),
    img: ({ src, alt }: { src?: string | Blob; alt?: string }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className='my-3 h-auto max-w-full rounded-md'
        src={typeof src === 'string' ? src : undefined}
        alt={alt ?? ''}
        referrerPolicy='no-referrer'
      />
    ),
  };

  const markdownSource = (item: SourceDocFixture['blocks'][number]) => {
    if (documentModel.sourceFormat !== 'markdown' && item.type === 'heading') {
      return `## ${item.sourceText}`;
    }
    return item.sourceText;
  };

  const threadConversation = (thread: SourceDocThread) => (
    <div className='space-y-6'>
      {thread.messages.map((message) => (
        <div
          key={message.id}
          className={`group flex flex-col gap-2 ${message.role === 'user' ? 'items-end' : 'items-stretch'}`}
        >
          {editingMessageId === message.id ? (
            <div className='w-full space-y-2'>
              <textarea
                aria-label='消息内容'
                className='textarea textarea-bordered w-full'
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
              />
              <div className='flex justify-end gap-2'>
                <button className='btn btn-xs btn-ghost eink-bordered' onClick={cancelMessageEdit}>
                  取消
                </button>
                <button className='btn btn-xs btn-contrast' onClick={saveMessage}>
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[88%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm leading-6 text-white'
                  : 'w-full text-[0.95rem] leading-7'
              }
            >
              <span>{message.content}</span>
              {message.attachment ? (
                <div className='mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs'>
                  <button
                    type='button'
                    className='flex w-full items-center justify-between px-2 py-1 text-left font-semibold text-amber-700'
                    aria-expanded={expandedAttachmentIds.includes(message.id)}
                    onClick={() =>
                      setExpandedAttachmentIds((current) =>
                        current.includes(message.id)
                          ? current.filter((id) => id !== message.id)
                          : [...current, message.id],
                      )
                    }
                  >
                    <span>原文附件</span>
                    <span aria-hidden='true'>
                      {expandedAttachmentIds.includes(message.id) ? '⌃' : '⌄'}
                    </span>
                  </button>
                  {expandedAttachmentIds.includes(message.id) ? (
                    <div className='max-h-24 overflow-y-auto border-t px-2 py-2 whitespace-pre-wrap'>
                      {message.attachment}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {message.role === 'assistant' && message.citations.length > 0 ? (
            <div
              className='overflow-hidden rounded-xl border'
              style={{ borderColor: dark ? '#4b5563' : '#e5e7eb' }}
            >
              <button
                className='flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-xs font-semibold hover:bg-black/5'
                aria-expanded={expandedEvidenceIds.includes(message.id)}
                aria-controls={`evidence-${message.id}`}
                onClick={() =>
                  setExpandedEvidenceIds((current) =>
                    current.includes(message.id)
                      ? current.filter((id) => id !== message.id)
                      : [...current, message.id],
                  )
                }
              >
                <span>
                  ▱　回答依据 <span style={{ color: muted }}>{message.citations.length} 段</span>
                </span>
                <span aria-hidden='true'>
                  {expandedEvidenceIds.includes(message.id) ? '⌃' : '⌄'}
                </span>
              </button>
              {expandedEvidenceIds.includes(message.id) ? (
                <div
                  id={`evidence-${message.id}`}
                  className='max-h-48 overflow-y-auto border-t'
                  style={{ borderColor: dark ? '#4b5563' : '#e5e7eb' }}
                >
                  {message.citations.map((citation, index) => (
                    <button
                      key={citation.id ?? `${message.id}-${citation.blockId}`}
                      className='block w-full border-b px-3 py-3 text-left text-xs last:border-b-0 hover:bg-blue-500/10'
                      style={{ borderColor: dark ? '#4b5563' : '#e5e7eb', color: foreground }}
                      aria-label={`引用 ${index + 1}：${citation.blockId}`}
                      onClick={() => navigateToCitation(citation)}
                    >
                      <span className='block font-semibold text-blue-500'>
                        {blockLabel(citation.blockId)} · {sectionLabel(citation.blockId)}
                      </span>
                      <q className='mt-1 block leading-5' style={{ color: muted }}>
                        {citation.exactQuote}
                      </q>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            className={`flex items-center gap-1 text-[10px] ${message.role === 'user' ? 'justify-end' : ''}`}
            style={{ color: muted }}
          >
            <span>{message.role === 'user' ? '你' : '本地示例回答'}</span>
            {thread.id === activeThreadId ? (
              <button
                className='rounded p-1 opacity-50 hover:bg-black/5 hover:opacity-100 group-hover:opacity-100'
                aria-label={`编辑消息：${message.content}`}
                title='编辑'
                onClick={() => {
                  setEditingMessageId(message.id);
                  setMessageDraft(message.content);
                }}
              >
                ✎
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <main
      className='full-height flex min-h-0 flex-col overflow-hidden'
      style={{ backgroundColor: surface, color: foreground }}
    >
      <style>{`
        ::highlight(${ANNOTATION_HIGHLIGHT}) {
          text-decoration: underline rgba(59, 130, 246, 0.55) 1px;
          text-underline-offset: 0.22em;
        }
        ::highlight(${ACTIVE_ANNOTATION_HIGHLIGHT}) {
          background-color: rgba(254, 240, 138, 0.68);
          text-decoration: underline #2563eb 2px;
          text-underline-offset: 0.22em;
        }
        ::highlight(${CITATION_HIGHLIGHT}) {
          background-color: #fde047;
          color: #111827;
        }
        ::highlight(${SELECTION_HIGHLIGHT}) {
          background-color: rgba(96, 165, 250, 0.32);
          text-decoration: underline rgba(37, 99, 235, 0.8) 2px;
          text-underline-offset: 0.2em;
        }
        .foundation-reader {
          scrollbar-color: ${dark ? '#4b5563' : '#c7c8c0'} transparent;
        }
        .foundation-gutter {
          background: ${dark ? 'rgba(17, 24, 39, 0.6)' : 'rgba(229, 231, 235, 0.72)'};
        }
        .foundation-sidebar {
          width: ${readingSettings.sidebarWidth}px;
          background: ${panel};
          flex: 0 0 ${readingSettings.sidebarWidth}px;
        }
        @media (max-width: 1100px) {
          .foundation-workbench {
            display: block !important;
          }
          .foundation-divider {
            position: absolute !important;
            right: ${sidebarOpen ? `min(${readingSettings.sidebarWidth}px, 88vw)` : '0'};
            top: 0;
            bottom: 0;
            display: block !important;
            width: 8px;
          }
          .foundation-sidebar {
            position: absolute !important;
            inset: 0 0 0 auto;
            z-index: 40;
            width: min(${readingSettings.sidebarWidth}px, 88vw);
            box-shadow: -18px 0 40px rgba(15, 23, 42, 0.18);
          }
        }
      `}</style>
      <header
        className='relative z-50 flex h-10 shrink-0 items-center border-b px-3'
        style={{ backgroundColor: panel, borderColor: dark ? '#374151' : '#e5e7eb' }}
        data-tauri-drag-region={!windowFullscreen}
        onMouseDown={(event) => void startWindowDragging(event)}
      >
        <div className='h-full flex-1' aria-label='窗口拖动区域' />
        <span className='sr-only'>
          {documentModel.sections.length} 章 · {documentModel.blocks.length} 个编号源块 ·{' '}
          {documentModel.sourceFormat === 'markdown' ? '用户 Markdown' : '内置测试文档'}
        </span>
        <div className='flex items-center gap-0.5'>
          <button
            className='h-7 w-9 rounded hover:bg-black/5'
            aria-label='最小化窗口'
            onClick={() => void minimizeWindow()}
          >
            −
          </button>
          <button
            className='h-7 w-9 rounded hover:bg-black/5'
            aria-label='全屏或取消全屏'
            onClick={() => void toggleFullscreen()}
          >
            □
          </button>
          <button
            className='h-7 w-9 rounded text-red-600 hover:bg-red-500/10'
            aria-label='关闭窗口'
            onClick={() => void closeWindow()}
          >
            ×
          </button>
        </div>
      </header>

      <div className='foundation-workbench relative flex min-h-0 flex-1'>
        <div
          ref={readerScrollRef}
          className='foundation-reader relative min-w-0 flex-1 overflow-y-auto'
        >
          <div className='pointer-events-none sticky top-0 z-30 h-0 overflow-visible'>
            <div
              className={`pointer-events-auto absolute left-1/2 top-2 w-[min(780px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-xl border shadow-lg backdrop-blur-xl transition-[max-height,opacity] duration-200 ${toolbarExpanded ? 'max-h-80 opacity-100' : 'max-h-8 opacity-75 hover:opacity-100'}`}
              style={{ backgroundColor: `${panel}f2`, borderColor: dark ? '#4b5563' : '#d1d5db' }}
              onMouseEnter={() => setToolbarHovered(true)}
              onMouseLeave={() => setToolbarHovered(false)}
              aria-label='阅读工具栏'
            >
              <div
                className='flex h-8 items-center justify-center px-3 text-[11px]'
                style={{ color: muted }}
              >
                {toolbarExpanded ? '阅读工具' : '•••'}
              </div>
              <div
                className={`border-t px-3 pb-3 pt-2 ${toolbarExpanded ? 'block' : 'hidden'}`}
                style={{ borderColor: dark ? '#4b5563' : '#e5e7eb' }}
              >
                <div className='flex flex-wrap items-center gap-1.5'>
                  {!libraryBookId ? (
                    <label className='btn btn-ghost btn-sm cursor-pointer' title='导入 Markdown'>
                      ＋ 导入
                      <input
                        aria-label='导入 Markdown'
                        className='hidden'
                        type='file'
                        accept='.md,.markdown,text/markdown,text/plain'
                        onChange={(event) => void importMarkdown(event.target.files?.[0])}
                      />
                    </label>
                  ) : null}
                  <a
                    className='btn btn-ghost btn-sm'
                    href='/library'
                    aria-label='返回书库'
                    title='返回书库'
                  >
                    ⌂ 书库
                  </a>
                  <button
                    className='btn btn-ghost btn-sm'
                    aria-label='切换主题'
                    title='切换主题'
                    onClick={() => setDark((value) => !value)}
                  >
                    ◐
                  </button>
                  <button
                    className='btn btn-ghost btn-sm'
                    aria-label={settingsOpen ? '收起阅读显示设置' : '展开阅读显示设置'}
                    aria-expanded={settingsOpen}
                    title='显示设置'
                    onClick={() => setSettingsOpen((value) => !value)}
                  >
                    Aa
                  </button>
                  {libraryBook?.format === 'TXT' ? (
                    <button
                      type='button'
                      className='btn btn-ghost btn-sm text-xs'
                      title='如果文字显示异常，切换到下一种常见编码'
                      onClick={() => {
                        const encodings: TxtEncoding[] = [
                          'utf-8',
                          'gb18030',
                          'big5',
                          'shift_jis',
                          'utf-16le',
                          'utf-16be',
                        ];
                        const next =
                          encodings[(encodings.indexOf(txtEncoding) + 1) % encodings.length]!;
                        void reparseLibraryDocument({ txtEncoding: next });
                      }}
                    >
                      换一种编码
                    </button>
                  ) : null}
                  {libraryBook?.format === 'HTML' ? (
                    <>
                      <button
                        type='button'
                        className='btn btn-ghost btn-sm text-xs'
                        onClick={() =>
                          void reparseLibraryDocument({
                            htmlMode: htmlMode === 'article' ? 'full' : 'article',
                          })
                        }
                      >
                        {htmlMode === 'article' ? '显示完整网页' : '只看正文'}
                      </button>
                      <button
                        type='button'
                        className='btn btn-ghost btn-sm text-xs'
                        aria-pressed={allowRemoteImages}
                        onClick={() =>
                          void reparseLibraryDocument({ allowRemoteImages: !allowRemoteImages })
                        }
                      >
                        {allowRemoteImages ? '停止远程图片' : '加载远程图片'}
                      </button>
                    </>
                  ) : null}
                  <label className='ml-auto flex items-center gap-2 px-2 text-xs'>
                    <input
                      type='checkbox'
                      className='toggle toggle-xs'
                      checked={readingSettings.toolbarPinned}
                      onChange={(event) => updateToolbarPinned(event.target.checked)}
                    />
                    常驻
                  </label>
                  <button
                    className='btn btn-ghost btn-sm text-xs'
                    title='清空测试数据'
                    onClick={() => {
                      store?.clear();
                      setDocumentModel(SOURCE_DOC_FIXTURE);
                      setAnchor(null);
                      setThreads([]);
                      setActiveThreadId(null);
                    }}
                  >
                    清空
                  </button>
                </div>
                {settingsOpen ? (
                  <div
                    className='mt-2 grid gap-2 border-t pt-3 sm:grid-cols-2'
                    style={{ borderColor: dark ? '#4b5563' : '#e5e7eb' }}
                  >
                    {(
                      [
                        [
                          'contentWidth',
                          '正文宽度',
                          520,
                          1000,
                          20,
                          `${readingSettings.contentWidth}px`,
                        ],
                        ['fontSize', '字号', 14, 28, 1, `${readingSettings.fontSize}px`],
                        [
                          'lineHeight',
                          '行距',
                          1.35,
                          2.4,
                          0.05,
                          readingSettings.lineHeight.toFixed(2),
                        ],
                      ] as const
                    ).map(([key, label, minimum, maximum, step, display]) => (
                      <label key={key} className='flex min-w-0 items-center gap-2 text-xs'>
                        <span className='w-14 shrink-0'>{label}</span>
                        <input
                          aria-label={
                            label === '字号' ? '正文字号' : label === '行距' ? '正文行距' : label
                          }
                          className='range range-xs min-w-0 flex-1'
                          type='range'
                          min={minimum}
                          max={maximum}
                          step={step}
                          value={readingSettings[key]}
                          onChange={(event) =>
                            updateReadingSetting(key, Number(event.target.value))
                          }
                        />
                        <span className='w-12 text-right' style={{ color: muted }}>
                          {display}
                        </span>
                      </label>
                    ))}
                    <label className='flex min-w-0 items-center gap-2 text-xs'>
                      <span className='w-14 shrink-0'>批注</span>
                      <select
                        aria-label='批注显示模式'
                        className='select select-xs select-bordered min-w-0 flex-1'
                        value={readingSettings.annotationDisplay}
                        onChange={(event) => {
                          const value = event.target.value as ReadingSettings['annotationDisplay'];
                          setReadingSettings((current) => {
                            const nextSettings = { ...current, annotationDisplay: value };
                            window.localStorage.setItem(
                              READING_SETTINGS_KEY,
                              JSON.stringify(nextSettings),
                            );
                            return nextSettings;
                          });
                        }}
                      >
                        <option value='underline'>仅下划线</option>
                        <option value='card'>仅侧标</option>
                        <option value='both'>下划线 + 侧标</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                <label
                  className='mt-2 flex items-center gap-2 border-t pt-2 text-[11px]'
                  style={{ borderColor: dark ? '#4b5563' : '#e5e7eb' }}
                  aria-label='阅读进度'
                >
                  <span>进度</span>
                  <input
                    className='range range-xs flex-1'
                    type='range'
                    min='0'
                    max='100'
                    step='1'
                    value={readingProgress}
                    onChange={(event) => jumpToProgress(Number(event.target.value))}
                  />
                  <span className='w-9 text-right'>{Math.round(readingProgress)}%</span>
                </label>
              </div>
            </div>
          </div>

          {importError || sourceWarnings.length > 0 ? (
            <div
              role={importError ? 'alert' : 'status'}
              className={`sticky top-12 z-20 mx-auto mt-12 flex w-fit max-w-[calc(100%-32px)] items-center gap-2 rounded-xl px-4 py-2 text-xs shadow-lg ${importError ? 'bg-red-600 text-white' : 'border border-amber-400 bg-amber-50 text-amber-950'}`}
            >
              <span>
                {importError || sourceWarnings.map((warning) => warning.message).join(' ')}
              </span>
              {libraryBook?.format === 'HTML' ? (
                sourceWarnings.some((warning) => warning.code === 'remote-images-blocked') ? (
                  <button
                    type='button'
                    className='rounded-md border border-current px-2 py-1 font-semibold'
                    onClick={() => void reparseLibraryDocument({ allowRemoteImages: true })}
                  >
                    加载远程图片
                  </button>
                ) : null
              ) : null}
            </div>
          ) : null}
          <div
            className='foundation-gutter px-5 pb-24 pt-14 sm:px-10'
            data-testid='reader-gutter'
            title='点击正文外灰色区域取消选中'
            onClick={(event) => {
              if (event.target === event.currentTarget) clearSelection();
            }}
          >
            <article
              className='foundation-paper mx-auto min-w-0 rounded-xl px-6 py-12 shadow-sm sm:px-14'
              style={{
                backgroundColor: panel,
                color: foreground,
                fontSize: `${readingSettings.fontSize}px`,
                lineHeight: readingSettings.lineHeight,
                width: `${readingSettings.contentWidth}px`,
                maxWidth: '100%',
              }}
              aria-label='SOURCE_DOC 阅读区'
              onMouseUp={captureSelection}
            >
              {documentModel.blocks.map((item) => {
                const highlighted = highlightedCitation?.blockId === item.id;
                const previewed = previewedThreadId
                  ? threads
                      .find((thread) => thread.id === previewedThreadId)
                      ?.anchor.selectedBlockIds.includes(item.id) === true
                  : false;
                const blockThreads = threadsByBlock.get(item.id) ?? [];
                const markerThreads = markerThreadsByBlock.get(item.id) ?? [];
                const previewThread =
                  markerThreads.find((candidate) => candidate.status === 'active') ??
                  markerThreads[0];
                return (
                  <section
                    key={item.id}
                    data-block-id={item.id}
                    data-testid={`source-block-${item.id}`}
                    data-highlighted={highlighted ? 'true' : 'false'}
                    data-previewed={previewed ? 'true' : 'false'}
                    className={`relative scroll-m-24 pl-1 ${item.type === 'heading' ? 'mb-5 mt-9 first:mt-0' : 'mb-[1em]'}`}
                    style={{ color: highlighted ? '#111827' : foreground }}
                  >
                    {previewThread &&
                    (readingSettings.annotationDisplay !== 'underline' ||
                      markerThreads.length > 1) ? (
                      <button
                        className='eink-bordered absolute right-full top-[0.15em] mr-3 flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-500/40 bg-blue-50 px-1.5 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500'
                        aria-label={`打开${blockLabel(item.id)} 的批注，共 ${markerThreads.length} 条`}
                        title={`${previewThread.title}：${previewThread.messages.at(-1)?.content ?? ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (markerThreads.length > 1) {
                            setAnnotationPickerBlockId(item.id);
                            setActiveThreadId(null);
                            setSidebarOpen(true);
                          } else {
                            selectThread(previewThread);
                          }
                        }}
                      >
                        {markerThreads.length > 1 ? markerThreads.length : '●'}
                      </button>
                    ) : null}
                    <div
                      data-source-text={item.id}
                      className='source-markdown [&_p]:m-0'
                      style={{ backgroundColor: highlighted ? '#fef08a' : undefined }}
                      onPointerDown={(event) => {
                        sourcePointerStart.current = { x: event.clientX, y: event.clientY };
                      }}
                      onClick={(event) => openThreadAtPointer(event, blockThreads)}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {markdownSource(item)}
                      </ReactMarkdown>
                    </div>
                  </section>
                );
              })}
            </article>
          </div>
        </div>

        <div
          role='separator'
          aria-label='调整批注栏宽度'
          aria-orientation='vertical'
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={readingSettings.sidebarWidth}
          className='foundation-divider relative z-50 block h-full w-2 shrink-0 cursor-col-resize touch-none border-x bg-black/5 hover:bg-blue-500/20'
          style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}
          onPointerDown={(event) => {
            sidebarDrag.current = {
              startX: event.clientX,
              startWidth: readingSettings.sidebarWidth,
            };
            globalThis.document.body.style.cursor = 'col-resize';
            globalThis.document.body.style.userSelect = 'none';
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            updateReadingSetting(
              'sidebarWidth',
              Math.min(
                SIDEBAR_MAX_WIDTH,
                Math.max(
                  SIDEBAR_MIN_WIDTH,
                  readingSettings.sidebarWidth + (event.key === 'ArrowLeft' ? 10 : -10),
                ),
              ),
            );
          }}
          tabIndex={0}
        >
          <button
            type='button'
            className='btn btn-circle btn-sm absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 border border-blue-300 bg-base-100 shadow-md'
            aria-label={sidebarOpen ? '收起批注栏' : '打开批注栏'}
            title={sidebarOpen ? '收起批注栏' : '打开批注栏'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            {sidebarOpen ? '‹' : '›'}
          </button>
        </div>
        {sidebarOpen ? (
          <aside
            className='foundation-sidebar relative z-40 h-full min-h-0 overflow-hidden border-l'
            style={{
              backgroundColor: panel,
              color: foreground,
              borderColor: dark ? '#374151' : '#e5e7eb',
              width: readingSettings.sidebarWidth,
              maxWidth: '100%',
            }}
            aria-label='对话批注'
          >
            <div className='grid h-full min-h-0 grid-rows-[58px_minmax(0,1fr)_auto]'>
              <header
                className='flex min-w-0 items-center justify-between gap-3 border-b px-4'
                style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-bold'>
                    {activeThread?.title ?? (anchor ? '新批注' : '对话批注')}
                  </p>
                  <p className='mt-0.5 truncate text-[11px]' style={{ color: muted }}>
                    {activeThread
                      ? `选中原文 · ${activeThread.messages.length} 条消息`
                      : anchor
                        ? `已选择 ${anchor.selectedBlockIds.length} 段原文`
                        : '选择原文后开始提问'}
                  </p>
                  {activeThread?.status === 'archived' ? (
                    <span className='sr-only'>已归档</span>
                  ) : null}
                  {anchor ? (
                    <span className='sr-only'>当前锚点 · {anchor.selectedBlockIds.length} 块</span>
                  ) : null}
                  {anchor ? (
                    <q data-testid='active-quote' className='sr-only'>
                      {anchor.exactQuote}
                    </q>
                  ) : null}
                </div>
                <button
                  className='h-8 w-8 shrink-0 rounded-lg text-lg hover:bg-black/5'
                  aria-label='打开批注管理'
                  title='批注管理'
                  onClick={() => setAnnotationManagerOpen(true)}
                >
                  ☷
                </button>
              </header>

              <section
                ref={conversationScrollRef}
                className='min-h-0 overflow-y-auto px-5 py-6'
                aria-label='批注对话消息'
              >
                {selectionError ? (
                  <p className='mb-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-600'>
                    {selectionError}
                  </p>
                ) : null}
                {annotationPickerBlockId ? (
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <p className='text-sm font-semibold'>该段落的批注</p>
                        <p className='text-xs' style={{ color: muted }}>
                          请选择要打开的对话
                        </p>
                      </div>
                      <button
                        type='button'
                        className='h-7 w-7 rounded-lg hover:bg-black/5'
                        aria-label='关闭批注列表'
                        onClick={() => setAnnotationPickerBlockId(null)}
                      >
                        ×
                      </button>
                    </div>
                    <div className='space-y-2'>
                      {(threadsByBlock.get(annotationPickerBlockId) ?? []).map((thread) => (
                        <button
                          type='button'
                          key={thread.id}
                          aria-label={`预览并打开批注：${thread.title}`}
                          className='w-full rounded-xl border px-3 py-3 text-left hover:bg-blue-500/10'
                          onClick={() => selectThread(thread)}
                          onMouseEnter={() => setPreviewedThreadId(thread.id)}
                          onMouseLeave={() => setPreviewedThreadId(null)}
                          onFocus={() => setPreviewedThreadId(thread.id)}
                          onBlur={() => setPreviewedThreadId(null)}
                        >
                          <strong className='block truncate text-sm'>{thread.title}</strong>
                          <span className='mt-1 block text-xs' style={{ color: muted }}>
                            {thread.messages.length} 条消息 ·{' '}
                            {thread.messages.at(-1)?.content ?? ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : activeThread ? (
                  threadConversation(activeThread)
                ) : (
                  <div className='flex h-full min-h-48 flex-col items-center justify-center px-6 text-center'>
                    <div className='mb-3 text-2xl' aria-hidden='true'>
                      ◌
                    </div>
                    <p className='text-sm font-medium'>
                      {anchor ? '针对所选原文提问' : '无锚点聊天'}
                    </p>
                    {selectionPreview ? (
                      <div className='relative mt-3 w-full'>
                        <blockquote
                          data-testid='selection-preview'
                          className='max-h-24 w-full overflow-y-auto rounded-lg border-l-2 border-blue-500 bg-blue-500/5 px-3 py-2 pr-8 text-left text-xs leading-5'
                        >
                          {selectionPreview}
                        </blockquote>
                        <button
                          type='button'
                          className='absolute right-1.5 top-1.5 h-5 w-5 rounded hover:bg-blue-500/10'
                          aria-label='取消当前选中'
                          title='取消当前选中'
                          onClick={clearSelection}
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                    <p className='mt-1 max-w-56 text-xs leading-5' style={{ color: muted }}>
                      {anchor
                        ? '发送后会创建批注，并生成本地固定示例回答。'
                        : '点击正文外灰色夹缝可取消选中；无锚点会话可从批注管理筛选。'}
                    </p>
                  </div>
                )}
                {navigationStatus ? (
                  <p role='status' className='sr-only'>
                    {navigationStatus}
                  </p>
                ) : null}
              </section>

              <footer
                className='border-t p-3'
                style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}
              >
                <button
                  type='button'
                  className={`mb-2 text-xs ${attachSelection ? 'text-blue-600' : ''}`}
                  aria-pressed={attachSelection}
                  aria-label='将选中文本作为问题附件'
                  onClick={() => setAttachSelection((value) => !value)}
                >
                  ⎘ {attachSelection ? '请选择要附加的文本…' : '附加选中文本'}
                </button>
                {questionAttachments.length > 0 ? (
                  <div
                    data-testid='question-attachments-list'
                    className='mb-2 max-h-40 space-y-1.5 overflow-y-auto pr-1'
                  >
                    <div className='text-xs font-semibold text-amber-700'>问题附件预览</div>
                    {questionAttachments.map((attachment, index) => (
                      <div
                        key={`${attachment}-${index}`}
                        className='relative rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 pr-8 text-xs'
                      >
                        <div className='max-h-16 overflow-y-auto whitespace-pre-wrap'>
                          {attachment}
                        </div>
                        <button
                          type='button'
                          className='absolute right-1.5 top-1.5 h-5 w-5 rounded hover:bg-amber-500/10'
                          aria-label={`删除附件 ${index + 1}`}
                          title='删除此附件'
                          onClick={() =>
                            setQuestionAttachments((current) =>
                              current.filter((_, attachmentIndex) => attachmentIndex !== index),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div
                  className='grid grid-cols-[1fr_auto] items-end gap-2 rounded-2xl border p-2 pl-3'
                  style={{ backgroundColor: mutedPanel, borderColor: dark ? '#4b5563' : '#d1d5db' }}
                >
                  <textarea
                    aria-label='问题'
                    className='max-h-28 min-h-10 w-full resize-none border-0 bg-transparent py-2 text-sm outline-none'
                    style={{ color: foreground }}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        ask();
                      }
                    }}
                    placeholder={
                      activeThreadId
                        ? '继续追问…'
                        : anchor
                          ? '针对所选原文提问…'
                          : '输入问题（无锚点）…'
                    }
                  />
                  <button
                    aria-label='提问'
                    className='grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white disabled:cursor-not-allowed disabled:opacity-40'
                    disabled={!question.trim()}
                    onClick={ask}
                  >
                    ➤
                  </button>
                </div>
                <p className='mt-1.5 text-center text-[10px]' style={{ color: muted }}>
                  Enter 发送 · Shift + Enter 换行 · 本地固定回复
                </p>
              </footer>
            </div>
            {annotationManagerOpen ? (
              <section
                aria-label='批注管理'
                className='absolute inset-0 z-50 grid min-h-0 grid-rows-[58px_auto_minmax(0,1fr)_auto]'
                style={{ backgroundColor: panel, color: foreground }}
              >
                <header
                  className='flex items-center gap-2 border-b px-3'
                  style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}
                >
                  <button
                    className='h-8 w-8 rounded-lg hover:bg-black/5'
                    aria-label='返回对话批注'
                    title='返回对话'
                    onClick={() => setAnnotationManagerOpen(false)}
                  >
                    ‹
                  </button>
                  <h2 className='min-w-0 flex-1 truncate text-sm font-bold'>批注管理</h2>
                  {selectedThread ? (
                    <button
                      className='h-8 w-8 rounded-lg hover:bg-black/5'
                      aria-label='重命名选中批注'
                      title='重命名选中批注'
                      onClick={() => {
                        setTitleDraft(selectedThread.title);
                        setEditingTitle(true);
                      }}
                    >
                      ✎
                    </button>
                  ) : null}
                </header>
                <div className='border-b p-3' style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}>
                  <input
                    aria-label='搜索批注'
                    className='input input-sm input-bordered w-full'
                    placeholder='搜索批注或原文'
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <label className='mt-2 flex items-center gap-2 text-xs' style={{ color: muted }}>
                    <input
                      type='checkbox'
                      checked={showUnanchoredOnly}
                      onChange={(event) => setShowUnanchoredOnly(event.target.checked)}
                    />
                    只看无锚点会话
                  </label>
                  {editingTitle ? (
                    <div className='mt-2 flex gap-2'>
                      <input
                        aria-label='批注标题'
                        className='input input-sm input-bordered min-w-0 flex-1'
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                      <button
                        className='btn btn-sm btn-contrast'
                        aria-label='保存标题'
                        onClick={renameActiveThread}
                      >
                        保存
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className='min-h-0 overflow-y-auto p-2'>
                  {visibleThreads.map((item) => {
                    const selected = selectedThreadIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`mb-1 grid grid-cols-[36px_4px_minmax(0,1fr)] items-stretch gap-2 rounded-xl p-2 hover:bg-black/5 ${item.id === activeThreadId ? 'bg-blue-500/10' : ''} ${selected ? 'ring-1 ring-blue-500/50' : ''}`}
                      >
                        <button
                          className='grid min-h-12 place-items-center rounded-lg hover:bg-blue-500/10'
                          aria-label={`选择批注：${item.title}`}
                          aria-pressed={selected}
                          title={selected ? '取消选择' : '选择'}
                          onClick={() => toggleThreadSelection(item.id)}
                        >
                          <span
                            aria-hidden='true'
                            className={`grid h-5 w-5 place-items-center rounded border text-xs ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-400'}`}
                          >
                            {selected ? '✓' : ''}
                          </span>
                        </button>
                        <span className='my-1 rounded-full bg-blue-500' />
                        <button
                          className='min-w-0 rounded-lg px-2 py-1 text-left'
                          aria-label={`打开批注：${item.title}`}
                          onClick={() => selectThread(item)}
                        >
                          <strong className='block truncate text-sm'>{item.title}</strong>
                          <span className='mt-1 block truncate text-xs' style={{ color: muted }}>
                            {item.anchor?.exactQuote ?? '无锚点会话'}
                          </span>
                          <span className='mt-1 block text-[10px]' style={{ color: muted }}>
                            {item.messages.length} 条消息
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <footer
                  className='flex items-center justify-between border-t px-3 py-2'
                  style={{ borderColor: dark ? '#374151' : '#e5e7eb' }}
                >
                  <button
                    className='btn btn-ghost btn-xs'
                    aria-label='全选当前批注'
                    onClick={() => {
                      const visibleIds = visibleThreads.map((item) => item.id);
                      const allSelected = visibleIds.every((id) => selectedThreadIds.includes(id));
                      setSelectedThreadIds((current) =>
                        allSelected
                          ? current.filter((id) => !visibleIds.includes(id))
                          : [...new Set([...current, ...visibleIds])],
                      );
                    }}
                  >
                    {visibleThreads.length > 0 &&
                    visibleThreads.every((item) => selectedThreadIds.includes(item.id))
                      ? '取消全选'
                      : '全选'}
                  </button>
                  <span className='text-xs' style={{ color: muted }}>
                    已选 {selectedThreadIds.length} 条
                  </span>
                  <button
                    className='btn btn-ghost btn-xs text-red-600 disabled:text-gray-400'
                    aria-label={`批量删除 ${selectedThreadIds.length} 条批注`}
                    title='批量删除所选批注'
                    disabled={selectedThreadIds.length === 0}
                    onClick={deleteSelectedThreads}
                  >
                    ⌫ 删除
                  </button>
                </footer>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
