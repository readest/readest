import { stubTranslation as _ } from '@/utils/misc';
import { filterPlatformKeys, normalizeShortcut } from '@/utils/shortcutKeys';

export type ShortcutEntry = {
  keys: string[];
  description: string;
  section: string;
};

const DEFAULT_SHORTCUTS = {
  onSwitchSideBar: {
    keys: ['ctrl+Tab', 'opt+Tab', 'alt+Tab'],
    description: _('Switch Sidebar Tab'),
    section: 'General',
  },
  onToggleSideBar: {
    keys: ['s'],
    description: _('Toggle Sidebar'),
    section: 'General',
  },
  onOpenTableOfContents: {
    keys: [],
    description: _('Toggle Table of Contents'),
    section: 'General',
  },
  onToggleNotebook: {
    keys: ['n'],
    description: _('Toggle Notebook'),
    section: 'General',
  },
  onShowSearchBar: {
    keys: ['ctrl+f', 'cmd+f'],
    description: _('Search in Book'),
    section: 'General',
  },
  onToggleScrollMode: {
    keys: ['shift+j'],
    description: _('Toggle Scroll Mode'),
    section: 'General',
  },
  onToggleSelectMode: {
    keys: ['shift+s'],
    description: _('Toggle Select Mode'),
    section: 'General',
  },
  onToggleBookmark: {
    keys: ['ctrl+b', 'cmd+b'],
    description: _('Toggle Bookmark'),
    section: 'General',
  },
  onToggleTTS: {
    keys: ['t'],
    description: _('Toggle Text to Speech'),
    section: 'Text to Speech',
  },
  onTTSPlayPause: {
    keys: [' '],
    description: _('Play / Pause TTS'),
    section: 'Text to Speech',
  },
  onTTSGoNextSentence: {
    keys: ['ctrl+]', 'cmd+]'],
    description: _('Next Sentence'),
    section: 'Text to Speech',
  },
  onTTSGoPreviousSentence: {
    keys: ['ctrl+[', 'cmd+['],
    description: _('Previous Sentence'),
    section: 'Text to Speech',
  },
  onTTSGoNextParagraph: {
    keys: ['ctrl+shift+}', 'cmd+shift+}'],
    description: _('Next Paragraph'),
    section: 'Text to Speech',
  },
  onTTSGoPreviousParagraph: {
    keys: ['ctrl+shift+{', 'cmd+shift+{'],
    description: _('Previous Paragraph'),
    section: 'Text to Speech',
  },
  onTTSHighlightSentence: {
    keys: ['shift+m'],
    description: _('Highlight Current Sentence'),
    section: 'Text to Speech',
  },
  onToggleParagraphMode: {
    keys: ['shift+p'],
    description: _('Toggle Paragraph Mode'),
    section: 'General',
  },
  onToggleAutoScroll: {
    keys: ['shift+a'],
    description: _('Toggle Auto Scroll'),
    section: 'General',
  },
  onStartRSVP: {
    keys: ['shift+v'],
    description: _('Speed Reading Mode'),
    section: 'General',
  },
  onToggleToolbar: {
    keys: ['Enter'],
    description: _('Toggle Toolbar'),
    section: 'General',
  },
  onHighlightSelection: {
    keys: ['ctrl+h', 'cmd+h'],
    description: _('Highlight Selection'),
    section: 'Selection',
  },
  onUnderlineSelection: {
    keys: ['ctrl+u', 'cmd+u'],
    description: _('Underline Selection'),
    section: 'Selection',
  },
  onAnnotateSelection: {
    keys: ['ctrl+n', 'cmd+n'],
    description: _('Annotate Selection'),
    section: 'Selection',
  },
  onSearchSelection: {
    keys: ['ctrl+f', 'cmd+f'],
    description: _('Search Selection'),
    section: 'Selection',
  },
  onCopySelection: {
    keys: ['ctrl+c', 'cmd+c'],
    description: _('Copy Selection'),
    section: 'Selection',
  },
  onTranslateSelection: {
    keys: ['ctrl+t', 'cmd+t'],
    description: _('Translate Selection'),
    section: 'Selection',
  },
  onDictionarySelection: {
    keys: ['ctrl+d', 'cmd+d'],
    description: _('Dictionary Lookup'),
    section: 'Selection',
  },
  onReadAloudSelection: {
    keys: ['ctrl+r', 'cmd+r'],
    description: _('Read Aloud Selection'),
    section: 'Selection',
  },
  onProofreadSelection: {
    // alt+p is a print-free alternative on Windows/Linux, where ctrl+p is
    // intercepted by the browser's print dialog (#4717).
    keys: ['ctrl+p', 'cmd+p', 'alt+p'],
    description: _('Proofread Selection'),
    section: 'Selection',
  },
  onAdjustTextSelection: {
    // Standard desktop shortcuts for refining an active selection (#4728):
    // Shift+←/→ by character, Ctrl/Alt(Option)+Shift+←/→ by word. Only act while
    // text is selected; otherwise these keys fall through to page navigation.
    keys: [
      'shift+ArrowLeft',
      'shift+ArrowRight',
      'ctrl+shift+ArrowLeft',
      'ctrl+shift+ArrowRight',
      'opt+shift+ArrowLeft',
      'opt+shift+ArrowRight',
    ],
    description: _('Adjust Text Selection'),
    section: 'Selection',
  },
  onOpenFontLayoutSettings: {
    keys: ['shift+f', 'ctrl+,', 'cmd+,'],
    description: _('Open Settings'),
    section: 'General',
  },
  onOpenCommandPalette: {
    keys: ['ctrl+shift+p', 'cmd+shift+p'],
    description: _('Open Command Palette'),
    section: 'General',
  },
  onOpenShortcutsHelp: {
    keys: ['shift+?'],
    description: _('Show Keyboard Shortcuts'),
    section: 'General',
  },
  onOpenBooks: {
    keys: ['ctrl+o', 'cmd+o'],
    description: _('Open Books'),
    section: 'General',
  },
  onReloadPage: {
    keys: ['shift+r'],
    description: _('Reload Page'),
    section: 'General',
  },
  onToggleFullscreen: {
    keys: ['F11'],
    description: _('Toggle Fullscreen'),
    section: 'Window',
  },
  onCloseWindow: {
    keys: ['ctrl+w', 'cmd+w'],
    description: _('Close Window'),
    section: 'Window',
  },
  onQuitApp: {
    keys: ['ctrl+q', 'cmd+q'],
    description: _('Quit App'),
    section: 'Window',
  },
  onGoLeft: {
    keys: ['ArrowLeft', 'h', 'shift+ '],
    description: _('Go Left / Previous Page'),
    section: 'Navigation',
  },
  onGoRight: {
    keys: ['ArrowRight', 'l', ' '],
    description: _('Go Right / Next Page'),
    section: 'Navigation',
  },
  onGoUp: {
    keys: ['ArrowUp', 'k'],
    description: _('Go Up'),
    section: 'Navigation',
  },
  onGoDown: {
    keys: ['ArrowDown', 'j'],
    description: _('Go Down'),
    section: 'Navigation',
  },
  onGoNext: {
    // 'shift+j' belongs to Toggle Scroll Mode, which claims it first.
    keys: ['shift+ArrowRight', 'shift+ArrowDown', 'PageDown'],
    description: _('Next Page'),
    section: 'Navigation',
  },
  onGoPrev: {
    keys: ['shift+k', 'shift+ArrowLeft', 'shift+ArrowUp', 'PageUp'],
    description: _('Previous Page'),
    section: 'Navigation',
  },
  onGoLeftSection: {
    keys: ['opt+ArrowLeft', 'alt+ArrowLeft'],
    description: _('Previous Chapter'),
    section: 'Navigation',
  },
  onGoRightSection: {
    keys: ['opt+ArrowRight', 'alt+ArrowRight'],
    description: _('Next Chapter'),
    section: 'Navigation',
  },
  onGoPrevSection: {
    keys: ['opt+ArrowUp', 'alt+ArrowUp'],
    description: _('Previous Chapter'),
    section: 'Navigation',
  },
  onGoNextSection: {
    keys: ['opt+ArrowDown', 'alt+ArrowDown'],
    description: _('Next Chapter'),
    section: 'Navigation',
  },
  onGoHalfPageDown: {
    // 'shift+ArrowDown' belongs to Next Page, which claims it first.
    keys: ['d'],
    description: _('Scroll Half Page Down'),
    section: 'Navigation',
  },
  onGoHalfPageUp: {
    // 'shift+ArrowUp' belongs to Previous Page, which claims it first.
    keys: ['u'],
    description: _('Scroll Half Page Up'),
    section: 'Navigation',
  },
  onGoBookStart: {
    keys: ['Home'],
    description: _('Start of Book'),
    section: 'Navigation',
  },
  onGoBookEnd: {
    keys: ['End'],
    description: _('End of Book'),
    section: 'Navigation',
  },
  onGoBack: {
    // 'shift+ArrowLeft' belongs to Previous Page and 'alt+ArrowLeft' to
    // Previous Chapter; both claim them first.
    keys: ['shift+h'],
    description: _('Go Back'),
    section: 'Navigation',
  },
  onGoForward: {
    // 'shift+ArrowRight' belongs to Next Page and 'alt+ArrowRight' to
    // Next Chapter; both claim them first.
    keys: ['shift+l'],
    description: _('Go Forward'),
    section: 'Navigation',
  },
  onZoomIn: {
    keys: ['ctrl+=', 'cmd+=', 'shift+='],
    description: _('Zoom In'),
    section: 'Zoom',
  },
  onZoomOut: {
    keys: ['ctrl+-', 'cmd+-', 'shift+-'],
    description: _('Zoom Out'),
    section: 'Zoom',
  },
  onResetZoom: {
    keys: ['ctrl+0', 'cmd+0'],
    description: _('Reset Zoom'),
    section: 'Zoom',
  },
  onSaveNote: {
    keys: ['ctrl+Enter', 'cmd+Enter'],
    description: _('Save Note'),
    section: 'Notes',
  },
  onEscape: {
    keys: ['Escape'],
    description: _('Close'),
    section: 'General',
  },
};

export type ShortcutConfig = {
  [K in keyof typeof DEFAULT_SHORTCUTS]: ShortcutEntry;
};

export type ShortcutAction = keyof ShortcutConfig;

export const SHORTCUT_SECTIONS = [
  _('General'),
  _('Navigation'),
  _('Text to Speech'),
  _('Selection'),
  _('Zoom'),
  _('Window'),
  _('Notes'),
] as const;

type ShortcutDisplayItem = {
  description: string;
  keys: string[];
};

type ShortcutDisplaySection = {
  section: string;
  items: ShortcutDisplayItem[];
};

export const getShortcutsForDisplay = (isMac: boolean): ShortcutDisplaySection[] => {
  const shortcuts = loadShortcuts();
  return SHORTCUT_SECTIONS.map((section) => {
    const itemMap = new Map<string, ShortcutDisplayItem>();
    for (const entry of Object.values(shortcuts)) {
      if (entry.section !== section) continue;
      const keys = filterPlatformKeys(entry.keys, isMac);
      if (keys.length === 0) continue;
      const existing = itemMap.get(entry.description);
      if (existing) {
        // Merge keys for entries with the same description
        for (const key of keys) {
          if (!existing.keys.includes(key)) {
            existing.keys.push(key);
          }
        }
      } else {
        itemMap.set(entry.description, { description: entry.description, keys });
      }
    }
    return { section, items: Array.from(itemMap.values()) };
  });
};

const cloneShortcuts = (shortcuts: ShortcutConfig): ShortcutConfig =>
  Object.fromEntries(
    Object.entries(shortcuts).map(([action, entry]) => [
      action,
      { ...entry, keys: [...entry.keys] },
    ]),
  ) as ShortcutConfig;

export const getDefaultShortcuts = (): ShortcutConfig => cloneShortcuts(DEFAULT_SHORTCUTS);

const isShortcutAction = (value: string): value is ShortcutAction => value in DEFAULT_SHORTCUTS;

const parseStoredShortcuts = (value: string | null): Record<string, string[]> => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((key) => typeof key === 'string'),
      ),
    );
  } catch {
    return {};
  }
};

// Load shortcuts from localStorage or fallback to defaults
export const loadShortcuts = (): ShortcutConfig => {
  const result = getDefaultShortcuts();
  if (typeof localStorage === 'undefined') return result;
  const customShortcuts = parseStoredShortcuts(localStorage.getItem('customShortcuts'));
  for (const [key, value] of Object.entries(customShortcuts)) {
    if (isShortcutAction(key)) {
      // Custom overrides only replace keys, preserving description and section
      result[key] = { ...result[key], keys: [...value] };
    }
  }
  return result;
};

export const getShortcutConflicts = (
  shortcuts: ShortcutConfig,
  action: ShortcutAction,
  binding: string,
): ShortcutAction[] => {
  const normalizedBinding = normalizeShortcut(binding);
  return (Object.keys(shortcuts) as ShortcutAction[]).filter(
    (candidate) =>
      candidate !== action &&
      shortcuts[candidate].keys.some((key) => normalizeShortcut(key) === normalizedBinding),
  );
};

export const setShortcutBinding = (
  shortcuts: ShortcutConfig,
  action: ShortcutAction,
  binding: string | null,
): ShortcutConfig => {
  const result = cloneShortcuts(shortcuts);
  if (!binding) {
    result[action].keys = [];
    return result;
  }

  const normalizedBinding = normalizeShortcut(binding);
  for (const candidate of Object.keys(result) as ShortcutAction[]) {
    if (candidate === action) continue;
    result[candidate].keys = result[candidate].keys.filter(
      (key) => normalizeShortcut(key) !== normalizedBinding,
    );
  }
  result[action].keys = [binding];
  return result;
};

export const resetShortcutBinding = (
  shortcuts: ShortcutConfig,
  action: ShortcutAction,
): ShortcutConfig => {
  const result = cloneShortcuts(shortcuts);
  const defaultKeys = new Set(DEFAULT_SHORTCUTS[action].keys.map(normalizeShortcut));
  for (const candidate of Object.keys(result) as ShortcutAction[]) {
    if (candidate === action) continue;
    const candidateDefaults = new Set(DEFAULT_SHORTCUTS[candidate].keys.map(normalizeShortcut));
    result[candidate].keys = result[candidate].keys.filter((key) => {
      const normalizedKey = normalizeShortcut(key);
      return !defaultKeys.has(normalizedKey) || candidateDefaults.has(normalizedKey);
    });
  }
  result[action].keys = [...DEFAULT_SHORTCUTS[action].keys];
  return result;
};

export const isShortcutCustomized = (
  shortcuts: ShortcutConfig,
  action: ShortcutAction,
): boolean => {
  const keys = shortcuts[action].keys;
  const defaultKeys = DEFAULT_SHORTCUTS[action].keys;
  return (
    keys.length !== defaultKeys.length || keys.some((key, index) => key !== defaultKeys[index])
  );
};

// Save custom shortcuts to localStorage
export const saveShortcuts = (shortcuts: ShortcutConfig) => {
  if (typeof localStorage === 'undefined') return;
  // Only persist bindings that differ from the defaults.
  const keysOnly: Record<string, string[]> = {};
  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    if (isShortcutCustomized(shortcuts, action)) keysOnly[action] = shortcuts[action].keys;
  }
  localStorage.setItem('customShortcuts', JSON.stringify(keysOnly));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('shortcutUpdate'));
};
