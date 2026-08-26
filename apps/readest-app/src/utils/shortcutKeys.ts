const MODIFIER_MAP_MAC: Record<string, string> = {
  ctrl: '⌃',
  cmd: '⌘',
  alt: '⌥',
  opt: '⌥',
  altgr: 'AltGr',
  shift: '⇧',
  meta: '⌘',
};

const MODIFIER_MAP_OTHER: Record<string, string> = {
  ctrl: 'Ctrl',
  cmd: 'Ctrl',
  alt: 'Alt',
  opt: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  meta: 'Win',
};

const MODIFIERS = new Set(['ctrl', 'cmd', 'alt', 'opt', 'altgr', 'shift', 'meta']);
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta']);

const SPECIAL_KEYS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  ' ': 'Space',
  tab: 'Tab',
  enter: 'Enter',
  plus: '+',
  mousex1: 'Mouse X1',
  mousex2: 'Mouse X2',
};

export const formatKeyForDisplay = (key: string, isMac: boolean): string => {
  const parts = key.split('+');
  const modMap = isMac ? MODIFIER_MAP_MAC : MODIFIER_MAP_OTHER;

  const modifiers: string[] = [];
  let baseKey = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS.has(lower)) {
      modifiers.push(modMap[lower]!);
    } else {
      baseKey = part;
    }
  }

  // Map special keys or capitalize single characters
  const lowerBase = baseKey.toLowerCase();
  let displayKey: string;
  if (SPECIAL_KEYS[lowerBase]) {
    displayKey = SPECIAL_KEYS[lowerBase]!;
  } else if (baseKey.length === 1 && baseKey >= 'a' && baseKey <= 'z') {
    displayKey = baseKey.toUpperCase();
  } else {
    displayKey = baseKey;
  }

  if (isMac) {
    return [...modifiers, displayKey].join('');
  }
  return [...modifiers, displayKey].join('+');
};

export type ShortcutEventLike = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'
> & { altGraphKey?: boolean };

type KeyboardShortcutEventLike = ShortcutEventLike & {
  getModifierState?: (key: string) => boolean;
};

type MouseShortcutEventLike = Pick<MouseEvent, 'button'> &
  Partial<Pick<MouseEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>>;

const parseShortcut = (shortcut: string) => {
  const keys = shortcut.toLowerCase().split('+');
  const shiftKey = keys.includes('shift');
  const key = keys.find((part) => !MODIFIERS.has(part));
  return {
    ctrlKey: keys.includes('ctrl'),
    altKey: keys.includes('alt') || keys.includes('opt'),
    altGraphKey: keys.includes('altgr'),
    metaKey: keys.includes('meta') || keys.includes('cmd'),
    shiftKey,
    key: shiftKey && key === '=' ? 'plus' : key,
  };
};

// Whether a keyboard event matches any of the given shortcut strings. `alt`/`opt`
// and `cmd`/`meta` are treated as equivalent, matching how shortcuts are authored.
export const matchesShortcut = (event: ShortcutEventLike, keys: string[]): boolean => {
  const key = event.key === '+' ? 'plus' : event.key.toLowerCase();
  const altGraphKey = !!event.altGraphKey;
  return keys.some((shortcut) => {
    const parsed = parseShortcut(shortcut);
    return (
      parsed.key === key &&
      parsed.ctrlKey === (altGraphKey ? false : event.ctrlKey) &&
      parsed.altKey === (altGraphKey ? false : event.altKey) &&
      parsed.altGraphKey === altGraphKey &&
      parsed.metaKey === event.metaKey &&
      parsed.shiftKey === event.shiftKey
    );
  });
};

const serializeShortcut = (
  key: string,
  event: Pick<ShortcutEventLike, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'> & {
    altGraphKey?: boolean;
  },
): string => {
  const altGraphKey = !!event.altGraphKey;
  const modifiers = [
    !altGraphKey && event.ctrlKey ? 'ctrl' : null,
    !altGraphKey && event.altKey ? 'alt' : null,
    altGraphKey ? 'altgr' : null,
    event.shiftKey ? 'shift' : null,
    event.metaKey ? 'meta' : null,
  ].filter((modifier): modifier is string => modifier !== null);
  const baseKey = key === '+' ? 'plus' : key;
  return [...modifiers, baseKey].join('+');
};

export const getShortcutFromKeyboardEvent = (event: KeyboardShortcutEventLike): string | null => {
  if (MODIFIER_KEYS.has(event.key) || event.key === 'Dead' || event.key === 'Unidentified') {
    return null;
  }
  const altGraphKey = !!event.altGraphKey || event.getModifierState?.('AltGraph') === true;
  return serializeShortcut(event.key, {
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altGraphKey,
  });
};

export const getShortcutFromMouseEvent = (event: MouseShortcutEventLike): string | null => {
  const key = event.button === 3 ? 'MouseX1' : event.button === 4 ? 'MouseX2' : null;
  if (!key) return null;
  return serializeShortcut(key, {
    ctrlKey: !!event.ctrlKey,
    altKey: !!event.altKey,
    metaKey: !!event.metaKey,
    shiftKey: !!event.shiftKey,
  });
};

export const normalizeShortcut = (shortcut: string): string => {
  const parsed = parseShortcut(shortcut);
  if (!parsed.key) return shortcut.toLowerCase();
  return serializeShortcut(parsed.key, parsed).toLowerCase();
};

const MAC_MODIFIERS = new Set(['cmd', 'opt']);
const OTHER_MODIFIERS = new Set(['ctrl', 'alt']);

const hasModifier = (key: string, modifiers: Set<string>): boolean => {
  const parts = key.split('+');
  return parts.some((p) => modifiers.has(p.toLowerCase()));
};

export const filterPlatformKeys = (keys: string[], isMac: boolean): string[] => {
  const preferred = isMac ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const excluded = isMac ? OTHER_MODIFIERS : MAC_MODIFIERS;

  const platformKeys = keys.filter((k) => hasModifier(k, preferred));
  const agnosticKeys = keys.filter((k) => !hasModifier(k, preferred) && !hasModifier(k, excluded));

  if (platformKeys.length > 0 || agnosticKeys.length > 0) {
    return [...agnosticKeys, ...platformKeys];
  }

  // Fallback: return all keys if none match
  return keys;
};
