// Static catalog of downloadable Piper voices exposed by the embedded
// (Android-only, sherpa-onnx-backed) engine. Unlike Edge/Native, Piper has
// no "ask the engine what it has" call — voices are files we choose to ship
// URLs for, so the catalog is data, not a network probe.
//
// archiveUrl points at sherpa-onnx's own pre-converted release package for
// that voice (model.onnx + tokens.txt + its own espeak-ng-data, which the
// plugin ignores in favor of a single shared copy — see PiperTTSPlugin.kt).
// Full list / add more voices from:
// https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
// (every voice at https://huggingface.co/rhasspy/piper-voices has a
// `vits-piper-<lang>-<name>-<quality>.tar.bz2` counterpart there — do NOT
// link the raw Hugging Face .onnx files directly, see
// android/README-SHERPA-ONNX.md for why).

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

export interface PiperVoiceDescriptor {
  id: string;
  name: string;
  lang: string;
  quality: 'x_low' | 'low' | 'medium' | 'high';
  archiveUrl: string;
  sizeBytes: number;
}

function voice(
  lang: string,
  speaker: string,
  quality: PiperVoiceDescriptor['quality'],
  displayName: string,
  sizeBytes: number,
): PiperVoiceDescriptor {
  const id = `${lang}-${speaker}-${quality}`;
  return {
    id,
    name: displayName,
    lang: lang.replace('_', '-'),
    quality,
    archiveUrl: `${RELEASE_BASE}/vits-piper-${id}.tar.bz2`,
    sizeBytes,
  };
}

export const PIPER_VOICE_CATALOG: PiperVoiceDescriptor[] = [
  voice('en_US', 'amy', 'medium', 'Amy (English US)', 63_000_000),
  voice('en_US', 'lessac', 'medium', 'Lessac (English US)', 63_000_000),
  voice('en_US', 'ryan', 'medium', 'Ryan (English US)', 63_000_000),
  voice('en_GB', 'alan', 'medium', 'Alan (English UK)', 63_000_000),
  voice('en_GB', 'semaine', 'medium', 'Semaine (English UK)', 63_000_000),
  voice('fr_FR', 'siwis', 'medium', 'Siwis (Français)', 63_000_000),
  voice('fr_FR', 'tom', 'medium', 'Tom (Français)', 63_000_000),
  voice('de_DE', 'thorsten', 'medium', 'Thorsten (Deutsch)', 63_000_000),
  voice('de_DE', 'mls', 'medium', 'MLS (Deutsch)', 63_000_000),
  voice('es_ES', 'davefx', 'medium', 'Davefx (Español)', 63_000_000),
  voice('es_ES', 'sharvard', 'medium', 'Sharvard (Español)', 63_000_000),
  voice('it_IT', 'paola', 'medium', 'Paola (Italiano)', 63_000_000),
  voice('pt_BR', 'faber', 'medium', 'Faber (Português BR)', 63_000_000),
  voice('nl_NL', 'mls', 'medium', 'MLS (Nederlands)', 63_000_000),
  voice('pl_PL', 'gosia', 'medium', 'Gosia (Polski)', 63_000_000),
  voice('ru_RU', 'irina', 'medium', 'Irina (Русский)', 63_000_000),
];

export function findPiperVoice(id: string): PiperVoiceDescriptor | undefined {
  return PIPER_VOICE_CATALOG.find((v) => v.id === id);
}

export function piperVoicesForLang(lang: string): PiperVoiceDescriptor[] {
  const short = lang.split(/[-_]/)[0]?.toLowerCase();
  return PIPER_VOICE_CATALOG.filter((v) => v.lang.toLowerCase().startsWith(short ?? lang));
}
