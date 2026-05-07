import { FileSystem } from '@/types/system';
import { getFilename } from '@/utils/path';
import { CustomTextureInfo } from '@/styles/textures';

export async function importImage(
  fs: FileSystem,
  file?: string | File,
): Promise<CustomTextureInfo | null> {
  let imagePath: string;
  if (typeof file === 'string') {
    const filePath = file;
    const fileobj = await fs.openFile(filePath, 'None');
    imagePath = fileobj.name || getFilename(filePath);
    await fs.copyFile(filePath, 'None', imagePath, 'Images');
  } else if (file) {
    imagePath = getFilename(file.name);
    await fs.writeFile(imagePath, 'Images', file);
  } else {
    return null;
  }

  return {
    name: imagePath.replace(/\.[^/.]+$/, ''),
    path: imagePath,
  };
}

export async function deleteImage(fs: FileSystem, texture: CustomTextureInfo): Promise<void> {
  await fs.removeFile(texture.path, 'Images');
}
