import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { eventDispatcher } from '@/utils/event';
import { SelectedFile } from '@/hooks/useFileSelector';
import { isTauriAppPlatform } from '@/services/environment';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useTranslation } from '@/hooks/useTranslation';
import { BOOK_ACCEPT_FORMATS } from '@/services/constants';
import { useSearchParams } from 'next/navigation';

export const useDragDropImport = () => {
  const _ = useTranslation();
  const searchParams = useSearchParams();
  const group = searchParams?.get('group') || '';

  const { appService } = useEnv();
  const [isDragging, setIsDragging] = useState(false);

  const handleDroppedFiles = async (files: File[] | string[]) => {
    if (files.length === 0) return;
    const supportedFiles = files.filter((file) => {
      let fileExt;
      if (typeof file === 'string') {
        fileExt = file.split('.').pop()?.toLowerCase();
      } else {
        fileExt = file.name.split('.').pop()?.toLowerCase();
      }
      return BOOK_ACCEPT_FORMATS.includes(`.${fileExt}`);
    });
    if (supportedFiles.length === 0) {
      eventDispatcher.dispatch('toast', {
        message: _('No supported files found. Supported formats: {{formats}}', {
          formats: BOOK_ACCEPT_FORMATS,
        }),
        type: 'error',
      });
      return;
    }

    if (appService?.hasHaptics) {
      impactFeedback('medium');
    }

    const selectedFiles = supportedFiles.map(
      (file) =>
        ({
          file: typeof file === 'string' ? undefined : file,
          path: typeof file === 'string' ? file : undefined,
        }) as SelectedFile,
    );
    eventDispatcher.dispatch('import-book-files', { files: selectedFiles, groupId: group });
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const files = Array.from(event.dataTransfer.files);
      handleDroppedFiles(files);
    }
  };

  useEffect(() => {
    const libraryPage = document.querySelector('.library-page');
    if (!appService?.isMobile) {
      libraryPage?.addEventListener('dragover', handleDragOver as unknown as EventListener);
      libraryPage?.addEventListener('dragleave', handleDragLeave as unknown as EventListener);
      libraryPage?.addEventListener('drop', handleDrop as unknown as EventListener);
    }

    if (isTauriAppPlatform()) {
      const unlisten = getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          handleDroppedFiles(event.payload.paths);
        } else {
          setIsDragging(false);
        }
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }

    return () => {
      if (!appService?.isMobile) {
        libraryPage?.removeEventListener('dragover', handleDragOver as unknown as EventListener);
        libraryPage?.removeEventListener('dragleave', handleDragLeave as unknown as EventListener);
        libraryPage?.removeEventListener('drop', handleDrop as unknown as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  return { isDragging };
};
