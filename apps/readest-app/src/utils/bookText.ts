import { FoliateView } from '@/types/view';
import { BookProgress } from '@/types/book';

function extractTextFromDoc(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll('script, style').forEach((el) => el.remove());
  return (clone.body?.textContent || clone.documentElement.textContent || '').trim();
}

export async function getCurrentPageText(_bookKey: string, view: FoliateView): Promise<string> {
  if (!view?.renderer) return '';

  try {
    const contents = view.renderer.getContents();
    if (!contents?.length) return '';

    const visibleDocs = contents.filter((content) => {
      if (!content.doc) return false;
      const rect = content.doc.documentElement.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (visibleDocs.length === 0) return '';

    return visibleDocs
      .map(({ doc }) => (doc ? extractTextFromDoc(doc) : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  } catch (error) {
    console.error('Error extracting current page text:', error);
    return '';
  }
}

export async function getCurrentChapterText(
  _bookKey: string,
  view: FoliateView,
  progress: BookProgress,
): Promise<string> {
  if (!view?.renderer || !progress) return '';

  try {
    const contents = view.renderer.getContents();
    if (!contents?.length) return '';

    const sectionHref = progress.sectionHref;
    if (sectionHref) {
      const sectionDoc = contents.find((content) => {
        if (!content.doc) return false;
        const baseURI = content.doc.baseURI || content.doc.URL;
        return baseURI.includes(sectionHref) || sectionHref.includes(baseURI);
      });

      if (sectionDoc?.doc) {
        return extractTextFromDoc(sectionDoc.doc);
      }
    }

    // Fallback: get text from current document
    const currentDoc = contents[0];
    return currentDoc?.doc ? extractTextFromDoc(currentDoc.doc) : '';
  } catch (error) {
    console.error('Error extracting current chapter text:', error);
    return '';
  }
}
