import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { isTauriAppPlatform } from '@/services/environment';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getStyles } from '@/utils/style';
import { tauriHandleToggleFullScreen, tauriQuitApp } from '@/utils/window';
import { eventDispatcher } from '@/utils/event';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/services/constants';
import { viewPagination } from './usePagination';
import useShortcuts from '@/hooks/useShortcuts';
import useBooksManager from './useBooksManager';

interface UseBookShortcutsProps {
  sideBarBookKey: string | null;
  bookKeys: string[];
}

const useBookShortcuts = ({ sideBarBookKey, bookKeys }: UseBookShortcutsProps) => {
  const { getView, getViewState, getViewSettings, setViewSettings } = useReaderStore();
  const { toggleSideBar, setSideBarBookKey } = useSidebarStore();
  const { setFontLayoutSettingsDialogOpen } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { toggleNotebook } = useNotebookStore();
  const { getNextBookKey } = useBooksManager();
  const viewSettings = getViewSettings(sideBarBookKey ?? '');
  const fontSize = viewSettings?.defaultFontSize ?? 16;
  const lineHeight = viewSettings?.lineHeight ?? 1.6;
  const distance = fontSize * lineHeight * 3;

  const toggleScrollMode = () => {
    const viewSettings = getViewSettings(sideBarBookKey ?? '');
    if (viewSettings && sideBarBookKey) {
      viewSettings.scrolled = !viewSettings.scrolled;
      setViewSettings(sideBarBookKey, viewSettings!);
      const flowMode = viewSettings.scrolled ? 'scrolled' : 'paginated';
      getView(sideBarBookKey)?.renderer.setAttribute('flow', flowMode);
    }
  };

  const switchSideBar = () => {
    if (sideBarBookKey) setSideBarBookKey(getNextBookKey(sideBarBookKey));
  };

  const goLeft = () => {
    const viewSettings = getViewSettings(sideBarBookKey ?? '');
    viewPagination(getView(sideBarBookKey), viewSettings, 'left');
  };

  const goRight = () => {
    const viewSettings = getViewSettings(sideBarBookKey ?? '');
    viewPagination(getView(sideBarBookKey), viewSettings, 'right');
  };

  const goPrev = () => {
    getView(sideBarBookKey)?.prev(distance);
  };

  const goNext = () => {
    getView(sideBarBookKey)?.next(distance);
  };

  const goBack = () => {
    getView(sideBarBookKey)?.history.back();
  };

  const goHalfPageDown = () => {
    const view = getView(sideBarBookKey);
    const viewSettings = getViewSettings(sideBarBookKey ?? '');
    if (view && viewSettings && viewSettings.scrolled) {
      view.next(view.renderer.size / 2);
    }
  };

  const goHalfPageUp = () => {
    const view = getView(sideBarBookKey);
    const viewSettings = getViewSettings(sideBarBookKey ?? '');
    if (view && viewSettings && viewSettings.scrolled) {
      view.prev(view.renderer.size / 2);
    }
  };

  const goForward = () => {
    getView(sideBarBookKey)?.history.forward();
  };

  const reloadPage = () => {
    window.location.reload();
  };

  const toggleFullscreen = async () => {
    if (isTauriAppPlatform()) {
      await tauriHandleToggleFullScreen();
    }
  };

  const quitApp = async () => {
    // on web platform use browser's default shortcut to close the tab
    if (isTauriAppPlatform()) {
      await tauriQuitApp();
    }
  };

  const showSearchBar = () => {
    eventDispatcher.dispatch('search', { term: '' });
  };

  const applyZoomLevel = (zoomLevel: number) => {
    if (!sideBarBookKey) return;
    const view = getView(sideBarBookKey);
    const bookData = getBookData(sideBarBookKey);
    const viewSettings = getViewSettings(sideBarBookKey)!;
    viewSettings!.zoomLevel = zoomLevel;
    setViewSettings(sideBarBookKey, viewSettings!);
    view?.renderer.setStyles?.(getStyles(viewSettings!));
    if (bookData?.bookDoc?.rendition?.layout === 'pre-paginated') {
      view?.renderer.setAttribute('scale-factor', zoomLevel);
    }
  };

  const zoomIn = () => {
    if (!sideBarBookKey) return;
    const viewSettings = getViewSettings(sideBarBookKey)!;
    const zoomLevel = viewSettings!.zoomLevel + ZOOM_STEP;
    applyZoomLevel(Math.min(zoomLevel, MAX_ZOOM_LEVEL));
  };

  const zoomOut = () => {
    if (!sideBarBookKey) return;
    const viewSettings = getViewSettings(sideBarBookKey)!;
    const zoomLevel = viewSettings!.zoomLevel - ZOOM_STEP;
    applyZoomLevel(Math.max(zoomLevel, MIN_ZOOM_LEVEL));
  };

  const resetZoom = () => {
    if (!sideBarBookKey) return;
    applyZoomLevel(100);
  };

  const toggleTTS = () => {
    if (!sideBarBookKey) return;
    const bookKey = sideBarBookKey;
    const viewState = getViewState(bookKey);
    eventDispatcher.dispatch(viewState?.ttsEnabled ? 'tts-stop' : 'tts-speak', { bookKey });
  };

  useShortcuts(
    {
      onSwitchSideBar: switchSideBar,
      onToggleSideBar: toggleSideBar,
      onToggleNotebook: toggleNotebook,
      onToggleScrollMode: toggleScrollMode,
      onOpenFontLayoutSettings: () => setFontLayoutSettingsDialogOpen(true),
      onToggleSearchBar: showSearchBar,
      onToggleFullscreen: toggleFullscreen,
      onToggleTTS: toggleTTS,
      onReloadPage: reloadPage,
      onQuitApp: quitApp,
      onGoLeft: goLeft,
      onGoRight: goRight,
      onGoPrev: goPrev,
      onGoNext: goNext,
      onGoHalfPageDown: goHalfPageDown,
      onGoHalfPageUp: goHalfPageUp,
      onGoBack: goBack,
      onGoForward: goForward,
      onZoomIn: zoomIn,
      onZoomOut: zoomOut,
      onResetZoom: resetZoom,
    },
    [sideBarBookKey, bookKeys],
  );
};

export default useBookShortcuts;
