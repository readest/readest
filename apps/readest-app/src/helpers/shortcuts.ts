export interface ShortcutConfig {
  onSwitchSideBar: string[];
  onToggleSideBar: string[];
  onToggleNotebook: string[];
  onToggleSearchBar: string[];
  onToggleScrollMode: string[];
  onToggleSelectMode: string[];
  onOpenFontLayoutSettings: string[];
  onReloadPage: string[];
  onQuitApp: string[];
  onGoLeft: string[];
  onGoRight: string[];
  onGoNext: string[];
  onGoPrev: string[];
  onGoHalfPageDown: string[];
  onGoHalfPageUp: string[];
  onGoBack: string[];
  onGoForward: string[];
  onZoomIn: string[];
  onZoomOut: string[];
  onResetZoom: string[];
  onSaveNote: string[];
  onCloseNote: string[];
}

const DEFAULT_SHORTCUTS: ShortcutConfig = {
  onSwitchSideBar: ['ctrl+Tab', 'opt+Tab', 'alt+Tab'],
  onToggleSideBar: ['s'],
  onToggleNotebook: ['n'],
  onToggleSearchBar: ['ctrl+f', 'cmd+f'],
  onToggleScrollMode: ['shift+j'],
  onToggleSelectMode: ['shift+s'],
  onOpenFontLayoutSettings: ['shift+f'],
  onReloadPage: ['shift+r'],
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
  onCloseNote: ['Escape'],
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
