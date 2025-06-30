const DEFAULT_SHORTCUTS = {
  onSwitchSideBar: ['ctrl+Tab', 'opt+Tab', 'alt+Tab'],
  onToggleSideBar: ['s'],
  onToggleNotebook: ['n'],
  onToggleSearchBar: ['ctrl+f', 'cmd+f'],
  onToggleScrollMode: ['shift+j'],
  onToggleSelectMode: ['shift+s'],
  onToggleTTS: ['t'],
  onOpenFontLayoutSettings: ['shift+f'],
  onReloadPage: ['shift+r'],
  onToggleFullscreen: ['F11'],
  onQuitApp: ['ctrl+q', 'cmd+q'],
  onGoLeft: ['ArrowLeft', 'PageUp', 'h'],
  onGoRight: ['ArrowRight', 'PageDown', 'l', ' '],
  onGoNext: ['ArrowDown', 'j'],
  onGoPrev: ['ArrowUp', 'k'],
  onGoHalfPageDown: ['shift+ArrowDown', 'd'],
  onGoHalfPageUp: ['shift+ArrowUp', 'u'],
  onGoBack: ['shift+ArrowLeft', 'shift+h'],
  onGoForward: ['shift+ArrowRight', 'shift+l'],
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
