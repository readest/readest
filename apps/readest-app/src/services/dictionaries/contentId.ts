import { partialMD5 } from '@/utils/md5';
import { computeDictionaryReplicaId } from '@/services/sync/adapters/dictionary';

/**
 * Compute the cross-device content-hash id for a dictionary bundle at
 * import time. Uses partialMD5 (head + middle + tail sample) of the
 * primary file, mixed with byteSize and the sorted filename list. The
 * mixing makes the id resilient to the partialMD5 collision risk
 * (Codex flagged 9/10 confidence; eng review accepted the mitigation).
 *
 * Stardict primary = .ifo (small text; partialMD5 is effectively full-hash).
 * MDict primary    = .mdx (body).
 * DICT primary     = .dict.dz (compressed body).
 * Slob primary     = .slob (single-file bundle).
 *
 * Same content → same id across devices, enabling per-record sync identity.
 */
export const computeDictionaryContentId = async (
  primary: File,
  filenames: string[],
): Promise<string> => {
  const partial = await partialMD5(primary);
  return computeDictionaryReplicaId(partial, primary.size, filenames);
};
