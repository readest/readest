const MODIFIER_MAP_MAC: Record<string, string> = {
  ctrl: '⌘',
  cmd: '⌘',
  alt: '⌥',
  opt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

const MODIFIER_MAP_OTHER: Record<string, string> = {
  ctrl: 'Ctrl',
  cmd: 'Ctrl',
  alt: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  meta: 'Win',
};

const MODIFIERS = new Set(['ctrl', 'cmd', 'alt', 'opt', 'shift', 'meta']);

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
>;

const parseShortcut = (shortcut: string) => {
  const keys = shortcut.toLowerCase().split('+');
  return {
    ctrlKey: keys.includes('ctrl'),
    altKey: keys.includes('alt') || keys.includes('opt'),
    metaKey: keys.includes('meta') || keys.includes('cmd'),
    shiftKey: keys.includes('shift'),
    key: keys.find((k) => !MODIFIERS.has(k)),
  };
};

// Whether a keyboard event matches any of the given shortcut strings. `alt`/`opt`
// and `cmd`/`meta` are treated as equivalent, matching how shortcuts are authored.
export const matchesShortcut = (event: ShortcutEventLike, keys: string[]): boolean => {
  const key = event.key.toLowerCase();
  return keys.some((shortcut) => {
    const parsed = parseShortcut(shortcut);
    return (
      parsed.key === key &&
      parsed.ctrlKey === event.ctrlKey &&
      parsed.altKey === event.altKey &&
      parsed.metaKey === event.metaKey &&
      parsed.shiftKey === event.shiftKey
    );
  });
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
