import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getImageMimeType, imageExtensionFromMime, imageToPng } from '@/utils/image';
import BookContextMenuPopup from '@/app/library/components/BookContextMenuPopup';

interface ImageMenuProps {
  getImage: () => Promise<Blob>;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Readest's menu for an image, from a right-click or a long press: Copy Image
 * and Save Image (#6558). Android's WebView takes a clipboard image write
 * without error but never puts it on the system clipboard, so Android offers
 * Share Image in its place (#6574).
 */
export const ImageMenu: React.FC<ImageMenuProps> = ({ getImage, position, onClose }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  // The PNG is handed over as a promise so the write starts inside the click:
  // WebKit refuses clipboard writes once the user gesture has passed.
  const copyImage = () => {
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': getImage().then(imageToPng) })])
      .catch((error) => {
        console.error('Failed to copy image:', error);
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to copy the image'),
        });
      });
  };

  // Some loaders leave images untyped (CBZ pages, for one): name the file by
  // what its bytes are, and make it a real PNG when they can't tell.
  const getImageFile = async () => {
    let blob = await getImage();
    let mimeType = blob.type.startsWith('image/')
      ? blob.type
      : getImageMimeType(new Uint8Array(await blob.arrayBuffer()));
    if (!mimeType) {
      blob = await imageToPng(blob);
      mimeType = 'image/png';
    }
    const filename = `image.${imageExtensionFromMime(mimeType)}`;
    return { filename, bytes: await blob.arrayBuffer(), mimeType };
  };

  const saveImage = async () => {
    try {
      const { filename, bytes, mimeType } = await getImageFile();
      // Android saves to the photo gallery, like the image viewer; some builds
      // (HarmonyOS) refuse the insert, so those save it as a file instead.
      if (
        appService?.isAndroidApp &&
        (await appService.saveImageToGallery(filename, bytes, mimeType))
      ) {
        eventDispatcher.dispatch('toast', { type: 'info', message: _('Image saved to gallery') });
        return;
      }
      const saved = await appService?.saveFile(filename, bytes, { mimeType });
      eventDispatcher.dispatch('toast', {
        type: saved ? 'info' : 'error',
        message: saved ? _('Image saved successfully') : _('Failed to save the image'),
      });
    } catch (error) {
      console.error('Failed to save image:', error);
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to save the image') });
    }
  };

  // The share sheet gives its own feedback, a dismissed one included; false
  // means the image never reached it.
  const shareImage = async () => {
    let shared: boolean | undefined = false;
    try {
      const { filename, bytes, mimeType } = await getImageFile();
      shared = await appService?.saveFile(filename, bytes, { mimeType, share: true });
    } catch (error) {
      console.error('Failed to share image:', error);
    }
    if (shared === false) {
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to share the image') });
    }
  };

  return (
    <BookContextMenuPopup
      position={position}
      items={
        appService?.isAndroidApp
          ? [
              { text: _('Save Image'), action: saveImage },
              { text: _('Share Image'), action: shareImage },
            ]
          : [
              { text: _('Copy Image'), action: copyImage },
              { text: _('Save Image'), action: saveImage },
            ]
      }
      onClose={onClose}
    />
  );
};

/**
 * The image menu for a book, EPUB or PDF alike, opened by the
 * `image-context-menu` event useTextSelector dispatches in place of the
 * webview's own menu.
 */
const ImageContextMenu: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const [menu, setMenu] = useState<Omit<ImageMenuProps, 'onClose'> | null>(null);

  useEffect(() => {
    const handleImageMenu = (event: CustomEvent) => {
      const { bookKey: key, getImage, x, y } = event.detail;
      if (key === bookKey) setMenu({ getImage, position: { x, y } });
    };
    eventDispatcher.on('image-context-menu', handleImageMenu);
    return () => eventDispatcher.off('image-context-menu', handleImageMenu);
  }, [bookKey]);

  return menu && <ImageMenu {...menu} onClose={() => setMenu(null)} />;
};

export default ImageContextMenu;
