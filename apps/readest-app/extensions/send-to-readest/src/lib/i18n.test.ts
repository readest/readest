import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
  vi.resetModules();
});

afterEach(() => {
  uninstallChromeMock();
});

describe('extension i18n locale selection', () => {
  test('uses exact regional bundles for Chrome hyphen locale codes', async () => {
    chromeMock.i18n.getUILanguage.mockReturnValue('zh-CN');
    const { translate } = await import('./i18n');
    expect(translate('Send to Readest')).toBe('发送到 Readest');
  });

  test('uses exact regional bundles for Chrome underscore locale codes', async () => {
    chromeMock.i18n.getUILanguage.mockReturnValue('pt_BR');
    const { translate } = await import('./i18n');
    expect(translate('Article is too large to send')).toBe(
      'O artigo é grande demais para ser enviado',
    );
  });

  test('falls back to the base language when no regional bundle exists', async () => {
    chromeMock.i18n.getUILanguage.mockReturnValue('de-CH');
    const { translate } = await import('./i18n');
    expect(translate('Send to Readest')).toBe('An Readest senden');
  });
});
