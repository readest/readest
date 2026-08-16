import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export interface PluginSourceManifestEntry {
  name: string;
  byteSize: number;
  sha256: string;
}

export const sha256File = async (file: Blob, chunkSize = 1024 * 1024): Promise<string> => {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error('SHA-256 chunk size must be a positive safe integer');
  }
  const digest = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = new Uint8Array(
      await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer(),
    );
    digest.update(chunk);
  }
  return bytesToHex(digest.digest());
};

export const computePluginDictionaryContentId = (
  pluginId: string,
  formatId: string,
  sources: PluginSourceManifestEntry[],
): string => {
  const canonical = [...sources]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, byteSize, sha256: hash }) => `${name}\0${byteSize}\0${hash}`)
    .join('\n');
  return bytesToHex(sha256(utf8ToBytes(`${pluginId}\n${formatId}\n${canonical}`)));
};
