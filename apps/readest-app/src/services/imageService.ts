import { FileSystem } from '@/types/system';
import { getFilename } from '@/utils/path';
import { md5, partialMD5 } from '@/utils/md5';
import { uniqueId } from '@/utils/misc';
import { CustomTextureInfo, getTextureName } from '@/styles/textures';

/**
 * Build the cross-device content id for a texture:
 * `md5(partialMD5 ‖ byteSize ‖ filename)`. Same recipe shape as
 * fontService.computeFontContentId — keeps the kinds aligned.
 */
export const computeTextureContentId = (
  partialMd5: string,
  byteSize: number,
  filename: string,
): string => md5(`${partialMd5}|${byteSize}|${filename}`);

/**
 * Import an image into the user's `Images` base under a per-texture
 * bundle dir (`<bundleDir>/<filename>`). The bundle dir is a fresh
 * `uniqueId()` — matches the font / dictionary import pattern. Returns
 * a CustomTextureInfo with the relative path, contentId, bundleDir,
 * and byteSize populated so the store can publish the replica row
 * immediately.
 */
export async function importImage(
  fs: FileSystem,
  file?: string | File,
): Promise<CustomTextureInfo | null> {
  const bundleDir = uniqueId();
  let filename: string;
  let bytes: ArrayBuffer;

  if (typeof file === 'string') {
    const filePath = file;
    const fileobj = await fs.openFile(filePath, 'None');
    filename = fileobj.name || getFilename(filePath);
    bytes = await fileobj.arrayBuffer();
  } else if (file) {
    filename = getFilename(file.name);
    bytes = await file.arrayBuffer();
  } else {
    return null;
  }

  const texturePath = `${bundleDir}/${filename}`;
  await fs.createDir(bundleDir, 'Images', true);
  await fs.writeFile(texturePath, 'Images', bytes);

  const textureFile = await fs.openFile(texturePath, 'Images');
  const partialMd5 = await partialMD5(textureFile);
  const byteSize = bytes.byteLength;
  const contentId = computeTextureContentId(partialMd5, byteSize, filename);

  return {
    name: getTextureName(filename),
    path: texturePath,
    bundleDir,
    contentId,
    byteSize,
  };
}

export async function deleteImage(fs: FileSystem, texture: CustomTextureInfo): Promise<void> {
  await fs.removeFile(texture.path, 'Images');
  // Also remove the per-texture bundle dir if it's now empty. Legacy
  // textures without bundleDir live at the flat `Images/<filename>`
  // path; nothing extra to clean up there.
  if (texture.bundleDir) {
    try {
      await fs.removeDir(texture.bundleDir, 'Images', true);
    } catch (err) {
      console.warn('Failed to remove texture bundleDir', texture.bundleDir, err);
    }
  }
}
