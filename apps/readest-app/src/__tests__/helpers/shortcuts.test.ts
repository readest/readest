import { describe, it, expect } from 'vitest';

// Use dynamic import to avoid module resolution issues in test
const getDefaults = async () => {
  const mod = await import('../../helpers/shortcuts');
  return mod.loadShortcuts();
};

describe('TTS play/pause shortcut', () => {
  it('should have onTTSPlayPause shortcut with space', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSPlayPause).toEqual([' ']);
  });

  it('should also have space in onGoRight as fallback', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onGoRight).toContain(' ');
  });
});

describe('TTS navigation shortcuts', () => {
  it('should have onTTSGoNextSentence shortcut with ctrl+] and cmd+]', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoNextSentence).toEqual(['ctrl+]', 'cmd+]']);
  });

  it('should have onTTSGoPreviousSentence shortcut with ctrl+[ and cmd+[', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoPreviousSentence).toEqual(['ctrl+[', 'cmd+[']);
  });

  it('should have onTTSGoNextParagraph shortcut with ctrl+shift+} and cmd+shift+}', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoNextParagraph).toEqual(['ctrl+shift+}', 'cmd+shift+}']);
  });

  it('should have onTTSGoPreviousParagraph shortcut with ctrl+shift+{ and cmd+shift+{', async () => {
    const shortcuts = await getDefaults();
    expect(shortcuts.onTTSGoPreviousParagraph).toEqual(['ctrl+shift+{', 'cmd+shift+{']);
  });
});
