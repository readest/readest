import { TTSMediaMetadataMode } from '@/services/tts/types';

interface BuildTTSMediaMetadataOptions {
  markText: string;
  markName: string;
  sectionLabel: string;
  title: string;
  author: string;
  ttsMediaMetadata: TTSMediaMetadataMode;
  previousSectionLabel?: string;
}

interface TTSMediaMetadataResult {
  title: string;
  artist: string;
  album: string;
  shouldUpdate: boolean;
}

export function buildTTSMediaMetadata(
  options: BuildTTSMediaMetadataOptions,
): TTSMediaMetadataResult {
  const {
    markText,
    markName,
    sectionLabel,
    title,
    author,
    ttsMediaMetadata,
    previousSectionLabel,
  } = options;

  if (ttsMediaMetadata === 'chapter') {
    const shouldUpdate =
      previousSectionLabel === undefined || previousSectionLabel !== sectionLabel;
    return {
      title: sectionLabel || title,
      artist: author,
      album: title,
      shouldUpdate,
    };
  }

  // sentence and paragraph share the same metadata mapping;
  // paragraph only updates on the first sentence of each block (markName "0")
  const shouldUpdate = ttsMediaMetadata === 'sentence' || markName === '0';
  return {
    title: markText,
    artist: sectionLabel || title,
    album: author,
    shouldUpdate,
  };
}
