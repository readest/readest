import { HardwarePageTurnerSettings, KeyBinding } from '@/types/settings';
import { stubTranslation as _ } from '@/utils/misc';

export type KeyCandidate = Pick<
  KeyBinding,
  'source' | 'id' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'altGraphKey'
>;
// `refresh` is an e-ink-only action (full screen refresh to clear ghosting);
// the others navigate. All share the same key-binding machinery.
export type PageTurnAction = 'pagePrev' | 'pageNext' | 'sectionPrev' | 'sectionNext' | 'refresh';

export const PAGE_TURN_ACTIONS: PageTurnAction[] = [
  'pagePrev',
  'pageNext',
  'sectionPrev',
  'sectionNext',
  'refresh',
];

const NATIVE_KEY_LABELS: Record<string, string> = {
  MediaNext: _('Media Next'),
  MediaPrevious: _('Media Previous'),
  MediaPlayPause: _('Media Play/Pause'),
  MediaFastForward: _('Media Fast Forward'),
  MediaRewind: _('Media Rewind'),
  VolumeUp: _('Volume Up'),
  VolumeDown: _('Volume Down'),
  PencilDoubleTap: _('Pencil Double Tap'),
  PencilSqueeze: _('Pencil Squeeze'),
};

// Apple Pencil gestures forwarded by the iOS native bridge (#5501). They ride
// the native-key channel but must not trigger media-key interception, which
// claims MPRemoteCommandCenter and affects Now Playing (see usePagination).
const PENCIL_NATIVE_KEYS = new Set(['PencilDoubleTap', 'PencilSqueeze']);

export const isPencilNativeKey = (id: string): boolean => PENCIL_NATIVE_KEYS.has(id);

const DOM_KEY_LABELS: Record<string, string> = {
  ArrowLeft: _('Arrow Left'),
  ArrowRight: _('Arrow Right'),
  ArrowUp: _('Arrow Up'),
  ArrowDown: _('Arrow Down'),
  PageUp: _('Page Up'),
  PageDown: _('Page Down'),
  Space: _('Space'),
  Enter: _('Enter'),
  MediaTrackNext: _('Media Next'),
  MediaTrackPrevious: _('Media Previous'),
  MediaPlayPause: _('Media Play/Pause'),
};

const DOM_MODIFIERS = [
  ['ctrlKey', 'Ctrl', 'Control'],
  ['altKey', 'Alt', 'Alt'],
  ['altGraphKey', 'AltGraph', 'Alt'],
  ['shiftKey', 'Shift', 'Shift'],
  ['metaKey', 'Meta', 'Meta'],
] as const;

type DomKeyEventLike = Partial<
  Pick<
    KeyboardEvent,
    'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'getModifierState'
  >
> & { altGraphKey?: boolean };

/** Normalize a native key name (from the OS bridge) into a `KeyBinding`. */
export const normalizeNativeKey = (name: string): KeyBinding => ({
  source: 'native',
  id: name,
  label: NATIVE_KEY_LABELS[name] ?? name,
});

/** True while the recorder is seeing a modifier press, before the chord's main key. */
export const isModifierKeyEvent = (event: Pick<KeyboardEvent, 'code' | 'key'>): boolean =>
  /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code) ||
  ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(event.key);

/** Normalize a DOM keyboard event (including modifiers) into a `KeyBinding`. */
export const normalizeDomKeyEvent = (event: DomKeyEventLike): KeyBinding => {
  const id = event.code || event.key || '';
  const key = event.key || '';
  const baseLabel = DOM_KEY_LABELS[id] ?? (key.length === 1 ? key.toUpperCase() : id);
  // Browsers commonly expose AltGraph as AltRight with synthetic Ctrl+Alt
  // flags. Those flags describe the modifier itself, not an additional chord.
  const isAltGraph =
    key === 'AltGraph' || !!event.altGraphKey || event.getModifierState?.('AltGraph') === true;
  const modifiers = new Set(
    DOM_MODIFIERS.filter(
      ([field, , keyPrefix]) =>
        (field === 'altGraphKey' ? isAltGraph : event[field]) &&
        !id.startsWith(keyPrefix) &&
        !(isAltGraph && (field === 'ctrlKey' || field === 'altKey')),
    ).map(([field]) => field),
  );
  return {
    source: 'dom',
    id,
    label: baseLabel,
    ...(modifiers.has('ctrlKey') ? { ctrlKey: true } : {}),
    ...(modifiers.has('altKey') ? { altKey: true } : {}),
    ...(modifiers.has('shiftKey') ? { shiftKey: true } : {}),
    ...(modifiers.has('metaKey') ? { metaKey: true } : {}),
    ...(modifiers.has('altGraphKey') ? { altGraphKey: true } : {}),
  };
};

/** Render a binding label by translating each part of a modifier chord independently. */
export const formatKeyBindingLabel = (
  binding: KeyBinding,
  translate: (value: string) => string,
): string =>
  [
    ...DOM_MODIFIERS.filter(([field]) => !!binding[field]).map(([, label]) => translate(label)),
    translate(binding.label),
  ].join(' + ');

/** True when `candidate` is the key described by `binding`. */
export const matchesBinding = (
  binding: KeyBinding | null | undefined,
  candidate: KeyCandidate,
): boolean =>
  !!binding &&
  binding.source === candidate.source &&
  binding.id === candidate.id &&
  DOM_MODIFIERS.every(([field]) => !!binding[field] === !!candidate[field]);

/**
 * Decide which page-turn action an incoming key triggers. Returns the
 * action, or `null` when the feature is disabled or the key is unbound.
 */
export const resolvePageTurn = (
  settings: HardwarePageTurnerSettings,
  candidate: KeyCandidate,
): PageTurnAction | null => {
  if (!settings.enabled) return null;
  for (const action of PAGE_TURN_ACTIONS) {
    if (matchesBinding(settings.bindings[action], candidate)) return action;
  }
  return null;
};
