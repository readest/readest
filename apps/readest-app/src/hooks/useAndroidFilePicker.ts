import { useEffect, useRef } from 'react';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';
import {
  FILE_SELECTION_PRESETS,
  SelectedFile,
  resolveTauriFileName,
} from '@/hooks/useFileSelector';

interface FilePickerResultPayload {
  uris: string[];
}

/**
 * Consume book files picked through the native-bridge file picker on Android.
 *
 * The Tauri dialog plugin's picker resolves a JS promise with the result, but
 * that promise dies whenever Android tears down the activity or process while
 * the system picker is in the foreground (low-RAM devices, FireOS — #1217).
 * The native-bridge picker instead delivers results as a `file-picker-result`
 * plugin event routed through the same pending-event queue as shared intents:
 * results emitted before this listener registers (cold start after a process
 * kill) are queued in Kotlin and replayed once the listener lands, so a pick
 * survives any WebView reload in between.
 *
 * Mount this wherever picked books can be imported (the library page). The
 * picker itself is opened fire-and-forget via `showFilePicker()` in
 * `utils/bridge`; cancellation simply emits nothing.
 */
export function useAndroidPickedBooks(
  appService: AppService | null,
  onPickedBooks: (files: SelectedFile[]) => void,
) {
  // Keep the native listener registered once per appService while always
  // dispatching to the latest callback: re-registering on every render would
  // thrash the native listener map and can drop queued events between the
  // unregister/register pair.
  const onPickedBooksRef = useRef(onPickedBooks);
  onPickedBooksRef.current = onPickedBooks;

  useEffect(() => {
    if (!appService?.isAndroidApp) return;

    const listener: Promise<PluginListener> = addPluginListener(
      'native-bridge',
      'file-picker-result',
      async (payload: FilePickerResultPayload) => {
        const uris = payload.uris || [];
        if (uris.length === 0) return;
        // The picker runs unfiltered (SAF cannot match book MIME types — see
        // useFileSelector), so resolve real display names first and re-apply
        // the book extension whitelist here, like the dialog-plugin path did.
        const files: SelectedFile[] = await Promise.all(
          uris.map(async (path) => ({ path, name: await resolveTauriFileName(path, appService) })),
        );
        const extensions = FILE_SELECTION_PRESETS.books.extensions;
        const books = files.filter(({ name }) => {
          const ext = name?.split('.').pop()?.toLowerCase() || 'unknown';
          return extensions.includes(ext);
        });
        if (books.length > 0) {
          onPickedBooksRef.current(books);
        }
      },
    );

    return () => {
      listener.then((l) => l.unregister());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
