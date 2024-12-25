// bookService.ts
import { Book, BookContent } from '@/types/book';
import { BookDoc, DocumentLoader } from '@/libs/document';
import { useSettingsStore } from '@/store/settingsStore';
import { EnvConfigType } from '@/services/environment';

export async function fetchBookDetails(book: Book, envConfig: EnvConfigType) {
    const appService = await envConfig.getAppService();
    const { settings } = useSettingsStore.getState();
    const { file } = await appService.loadBookContent(book, settings) as BookContent;
    const bookDoc = (await new DocumentLoader(file).open()).book as BookDoc;
    console.log('bookDoc', bookDoc);
    return bookDoc.metadata;
}