// The BookOrbit half of read-along narration.
//
// A paired BookOrbit book has no local audio file to open: its tracks live on
// the server, and BookOrbit's own URL cannot be given to a media element at all
// (`Cross-Origin-Resource-Policy: same-origin`). Where the loopback media proxy
// is available the tracks stream through it and seek normally, which starting a
// chapter part-way into a track needs; elsewhere the bytes come through the
// client's native fetch and play from a blob, one track at a time.
import type { NarrationTrack } from '@/services/tts/mediaOverlay/MultiTrackNarrationClock';
import type { PairedAudiobookBookOrbitSource } from '@/types/book';
import { createBookOrbitClient } from './createClient';
import { openBookOrbitMediaProxy } from './mediaProxy';

/**
 * The pairing's tracks on the narration timeline. Each `url` is a streamable
 * loopback URL where the proxy is available, and otherwise the asset's
 * server-relative path, which {@link loadBookOrbitTrack} is handed back.
 */
export const bookOrbitNarrationTracks = async (
  source: PairedAudiobookBookOrbitSource,
): Promise<NarrationTrack[]> => {
  const client = createBookOrbitClient();
  const streamUrl = client ? await openBookOrbitMediaProxy(client) : null;
  return source.tracks.map((track) => ({
    url: streamUrl?.(track.contentUrl) ?? track.contentUrl,
    startOffset: track.startOffset,
    duration: track.duration,
  }));
};

export const loadBookOrbitTrack = async (contentPath: string): Promise<Blob> => {
  // Built per track rather than cached: a track lasts tens of minutes, far
  // longer than the 15-minute access token, so a kept client would only have
  // to re-authenticate anyway -- and this one cannot go stale against the
  // settings row.
  const client = createBookOrbitClient();
  if (!client) throw new Error('BookOrbit server not found');
  const res = await client.fetchAsset(contentPath);
  if (!res.ok) throw new Error(`BookOrbit asset fetch failed: ${res.status}`);
  return res.blob();
};
