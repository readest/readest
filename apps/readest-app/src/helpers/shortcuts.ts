const DEFAULT_SHORTCUTS = {
  onSwitchSideBar: ['ctrl+Tab', 'opt+Tab', 'alt+Tab'],
  onToggleSideBar: ['s'],
  onToggleNotebook: ['n'],
  onShowSearchBar: ['ctrl+f', 'cmd+f'],
  onToggleScrollMode: ['shift+j'],
  onToggleSelectMode: ['shift+s'],
  onToggleBookmark: ['ctrl+d', 'cmd+d'],
  onToggleTTS: ['t'],
  onHighlightSelection: ['ctrl+h', 'cmd+h'],
  onUnderlineSelection: ['ctrl+u', 'cmd+u'],
  onAnnotateSelection: ['ctrl+n', 'cmd+n'],
  onSearchSelection: ['ctrl+f', 'cmd+f'],
  onCopySelection: ['ctrl+c', 'cmd+c'],
  onTranslateSelection: ['ctrl+t', 'cmd+t'],
  onDictionarySelection: ['ctrl+d', 'cmd+d'],
  onWikipediaSelection: ['ctrl+w', 'cmd+w'],
  onReadAloudSelection: ['ctrl+r', 'cmd+r'],
  onProofreadSelection: ['ctrl+p', 'cmd+p'],
  onOpenFontLayoutSettings: ['shift+f', 'ctrl+,', 'cmd+,'],
  onOpenBooks: ['ctrl+o'],
  onReloadPage: ['shift+r'],
  onToggleFullscreen: ['F11'],
  onCloseWindow: ['ctrl+w', 'cmd+w'],
  onQuitApp: ['ctrl+q', 'cmd+q'],
  onGoLeft: ['ArrowLeft', 'h', 'shift+ '],
  onGoRight: ['ArrowRight', 'l', ' '],
  onGoUp: ['ArrowUp', 'k'],
  onGoDown: ['ArrowDown', 'j'],
  onGoNext: ['shift+j', 'shift+ArrowRight', 'shift+ArrowDown', 'PageDown'],
  onGoPrev: ['shift+k', 'shift+ArrowLeft', 'shift+ArrowUp', 'PageUp'],
  onGoLeftSection: ['opt+ArrowLeft', 'alt+ArrowLeft'],
  onGoRightSection: ['opt+ArrowRight', 'alt+ArrowRight'],
  onGoPrevSection: ['opt+ArrowUp', 'alt+ArrowUp'],
  onGoNextSection: ['opt+ArrowDown', 'alt+ArrowDown'],
  onGoHalfPageDown: ['shift+ArrowDown', 'd'],
  onGoHalfPageUp: ['shift+ArrowUp', 'u'],
  onGoBack: ['shift+ArrowLeft', 'shift+h', 'alt+ArrowLeft'],
  onGoForward: ['shift+ArrowRight', 'shift+l', 'alt+ArrowRight'],
  onZoomIn: ['ctrl+=', 'cmd+=', 'shift+='],
  onZoomOut: ['ctrl+-', 'cmd+-', 'shift+-'],
  onResetZoom: ['ctrl+0', 'cmd+0'],
  onSaveNote: ['ctrl+Enter'],
  onEscape: ['Escape'],
};

export type ShortcutConfig = {
  [K in keyof typeof DEFAULT_SHORTCUTS]: string[];
};

// Load shortcuts from localStorage or fallback to defaults
export const loadShortcuts = (): ShortcutConfig => {
  if (typeof localStorage === 'undefined') return DEFAULT_SHORTCUTS;
  const customShortcuts = JSON.parse(localStorage.getItem('customShortcuts') || '{}');
  return {
    ...DEFAULT_SHORTCUTS,
    ...customShortcuts,
  };
};

// Save custom shortcuts to localStorage
export const saveShortcuts = (shortcuts: ShortcutConfig) => {
  localStorage.setItem('customShortcuts', JSON.stringify(shortcuts));
};
