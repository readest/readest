import { HardwarePageTurnerSettings, KeyBinding } from '@/types/settings';
import { stubTranslation as _ } from '@/utils/misc';

export type KeyCandidate = { source: 'native' | 'dom'; id: string };
export type PageTurnAction = 'pagePrev' | 'pageNext' | 'sectionPrev' | 'sectionNext';

export const PAGE_TURN_ACTIONS: PageTurnAction[] = [
  'pagePrev',
  'pageNext',
  'sectionPrev',
  'sectionNext',
];

const NATIVE_KEY_LABELS: Record<string, string> = {
  MediaNext: _('Media Next'),
  MediaPrevious: _('Media Previous'),
  MediaPlayPause: _('Media Play/Pause'),
  MediaFastForward: _('Media Fast Forward'),
  MediaRewind: _('Media Rewind'),
  VolumeUp: _('Volume Up'),
  VolumeDown: _('Volume Down'),
};

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

/** Normalize a native key name (from the OS bridge) into a `KeyBinding`. */
export const normalizeNativeKey = (name: string): KeyBinding => ({
  source: 'native',
  id: name,
  label: NATIVE_KEY_LABELS[name] ?? name,
});

/** Normalize a DOM `KeyboardEvent` into a `KeyBinding`. */
export const normalizeDomKeyEvent = (event: KeyboardEvent): KeyBinding => {
  const id = event.code || event.key;
  return {
    source: 'dom',
    id,
    label: DOM_KEY_LABELS[id] ?? id,
  };
};

/** True when `candidate` is the key described by `binding`. */
export const matchesBinding = (binding: KeyBinding | null, candidate: KeyCandidate): boolean =>
  !!binding && binding.source === candidate.source && binding.id === candidate.id;

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
