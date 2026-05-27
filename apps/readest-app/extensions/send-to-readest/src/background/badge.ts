/**
 * Visible toolbar badge feedback. The popup auto-closes the moment the user
 * tabs away, and not everyone opens the SW console — the badge is the most
 * unambiguous "is anything happening" signal we have.
 */

type Phase = 'cap' | 'img' | 'epub' | 'send' | 'ok' | 'err' | 'clear';

const COLORS: Record<Exclude<Phase, 'clear'>, string> = {
  cap: '#1a73e8',
  img: '#1a73e8',
  epub: '#1a73e8',
  send: '#1a73e8',
  ok: '#1e8e3e',
  err: '#c0392b',
};

const LABELS: Record<Exclude<Phase, 'clear'>, string> = {
  cap: '…',
  img: 'IMG',
  epub: 'EPB',
  send: 'UP',
  ok: '✓',
  err: '!',
};

export function setBadge(phase: Phase): void {
  if (phase === 'clear') {
    chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
    return;
  }
  chrome.action.setBadgeBackgroundColor({ color: COLORS[phase] }).catch(() => undefined);
  chrome.action.setBadgeText({ text: LABELS[phase] }).catch(() => undefined);
}
