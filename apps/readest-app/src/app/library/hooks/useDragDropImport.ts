import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { eventDispatcher } from '@/utils/event';
import { SelectedFile } from '@/hooks/useFileSelector';
import { isTauriAppPlatform } from '@/services/environment';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useTranslation } from '@/hooks/useTranslation';
import { BOOK_ACCEPT_FORMATS, SUPPORTED_BOOK_EXTS } from '@/services/constants';
import { useSearchParams } from 'next/navigation';

const hasSupportedBookExt = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? SUPPORTED_BOOK_EXTS.includes(ext) : false;
};

export const useDragDropImport = () => {
  const _ = useTranslation();
  const searchParams = useSearchParams();
  const group = searchParams?.get('group') || '';

  const { appService } = useEnv();
  const [isDragging, setIsDragging] = useState(false);

  const handleDroppedFiles = async (droppedItems: File[] | string[]) => {
    if (droppedItems.length === 0 || !appService) return;

    const fileItems: (File | string)[] = [];
    const directoryPaths: string[] = [];
    for (const item of droppedItems) {
      if (typeof item === 'string' && (await appService.isDirectory(item, 'None'))) {
        directoryPaths.push(item);
      } else {
        fileItems.push(item);
      }
    }

    const fileSelections: SelectedFile[] = fileItems
      .filter((item) => hasSupportedBookExt(typeof item === 'string' ? item : item.name))
      .map((item) => ({
        file: typeof item === 'string' ? undefined : item,
        path: typeof item === 'string' ? item : undefined,
      }));

    if (fileSelections.length === 0 && directoryPaths.length === 0) {
      eventDispatcher.dispatch('toast', {
        message: _('No supported files found. Supported formats: {{formats}}', {
          formats: BOOK_ACCEPT_FORMATS,
        }),
        type: 'error',
      });
      return;
    }

    if (appService.hasHaptics) {
      impactFeedback('medium');
    }

    if (fileSelections.length > 0) {
      eventDispatcher.dispatch('import-book-files', {
        files: fileSelections,
        groupId: group,
      });
    }
    for (const dir of directoryPaths) {
      eventDispatcher.dispatch('import-book-directory', { path: dir });
    }
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
