import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';
import { setBadge } from './badge';

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

describe('setBadge', () => {
  test('clears the badge with an empty text when phase is "clear"', () => {
    setBadge('clear');
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(chromeMock.action.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  test('emits the labelled badge + colour for in-flight phases', () => {
    const cases: { phase: 'cap' | 'img' | 'epub' | 'send'; text: string }[] = [
      { phase: 'cap', text: '…' },
      { phase: 'img', text: 'IMG' },
      { phase: 'epub', text: 'EPB' },
      { phase: 'send', text: 'UP' },
    ];
    for (const { phase, text } of cases) {
      chromeMock.action.setBadgeText.mockClear();
      chromeMock.action.setBadgeBackgroundColor.mockClear();
      setBadge(phase);
      expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text });
      // All in-flight phases use the brand blue.
      expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#1a73e8',
      });
    }
  });

  test('"ok" uses the success colour and check mark', () => {
    setBadge('ok');
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '✓' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: '#1e8e3e',
    });
  });

  test('"err" uses the error colour and bang', () => {
    setBadge('err');
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: '#c0392b',
    });
  });
});
