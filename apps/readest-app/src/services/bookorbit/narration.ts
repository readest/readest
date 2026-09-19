// The BookOrbit half of read-along narration.
//
// A paired BookOrbit book has no local audio file to open: its tracks live on
// the server, and a media element cannot load them from their URLs at all --
// BookOrbit sends `Cross-Origin-Resource-Policy: same-origin`, which a webview
// refuses cross-origin whatever credentials are attached. So the bytes come
// through the client's native fetch and play from a blob, one track at a time,
// exactly as downloaded audiobooks do (see BlobAudioClock).
import type { NarrationTrack } from '@/services/tts/mediaOverlay/MultiTrackNarrationClock';
import type { PairedAudiobookBookOrbitSource } from '@/types/book';
import { createBookOrbitClient } from './createClient';

/**
 * The pairing's tracks on the narration timeline. Each `url` is the asset's
 * server-relative path, which is what {@link loadBookOrbitTrack} is handed back.
 */
export const bookOrbitNarrationTracks = (
  source: PairedAudiobookBookOrbitSource,
): NarrationTrack[] =>
  source.tracks.map((track) => ({
    url: track.contentUrl,
    startOffset: track.startOffset,
    duration: track.duration,
  }));

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
