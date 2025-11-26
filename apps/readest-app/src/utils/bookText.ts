import { FoliateView } from '@/types/view';
import { BookProgress } from '@/types/book';
import { getTextFromRange } from './sel';

/**
 * Extract text from the current page visible in the view
 */
export async function getCurrentPageText(
  bookKey: string,
  view: FoliateView,
): Promise<string> {
  if (!view || !view.renderer) {
    return '';
  }

  try {
    const contents = view.renderer.getContents();
    if (!contents || contents.length === 0) {
      return '';
    }

    // Get the current visible document(s)
    const visibleDocs = contents.filter((content) => {
      if (!content.doc) return false;
      const rect = content.doc.documentElement.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (visibleDocs.length === 0) {
      return '';
    }

    // Extract text from all visible documents
    const textParts: string[] = [];
    for (const { doc } of visibleDocs) {
      if (!doc) continue;

      // Clone the document to avoid modifying the original
      const clone = doc.cloneNode(true) as Document;
      
      // Remove script and style elements
      const scripts = clone.querySelectorAll('script, style');
      scripts.forEach((el) => el.remove());

      // Get text content
      const text = clone.body?.textContent || clone.documentElement.textContent || '';
      if (text.trim()) {
        textParts.push(text.trim());
      }
    }

    return textParts.join('\n\n').trim();
  } catch (error) {
    console.error('Error extracting current page text:', error);
    return '';
  }
}

/**
 * Extract text from the current chapter/section
 */
export async function getCurrentChapterText(
  bookKey: string,
  view: FoliateView,
  progress: BookProgress,
): Promise<string> {
  if (!view || !view.renderer || !progress) {
    return '';
  }

  try {
    const contents = view.renderer.getContents();
    if (!contents || contents.length === 0) {
      return '';
    }

    // Get the current section index from progress
    const currentSectionIndex = progress.section?.current ?? 0;
    const sectionHref = progress.sectionHref;

    if (sectionHref) {
      // Find the document that matches the current section
      const sectionDoc = contents.find((content) => {
        if (!content.doc) return false;
        const baseURI = content.doc.baseURI || content.doc.URL;
        return baseURI.includes(sectionHref) || sectionHref.includes(baseURI);
      });

      if (sectionDoc?.doc) {
        const clone = sectionDoc.doc.cloneNode(true) as Document;
        const scripts = clone.querySelectorAll('script, style');
        scripts.forEach((el) => el.remove());
        const text = clone.body?.textContent || clone.documentElement.textContent || '';
        return text.trim();
      }
    }

    // Fallback: get all text from current document
    const currentDoc = contents[0];
    if (currentDoc?.doc) {
      const clone = currentDoc.doc.cloneNode(true) as Document;
      const scripts = clone.querySelectorAll('script, style');
      scripts.forEach((el) => el.remove());
      const text = clone.body?.textContent || clone.documentElement.textContent || '';
      return text.trim();
    }

    return '';
  } catch (error) {
    console.error('Error extracting current chapter text:', error);
    return '';
  }
}

/**
 * Extract text from a range (for highlights)
 */
export function getTextFromSelection(range: Range): string {
  try {
    return getTextFromRange(range, []);
  } catch (error) {
    console.error('Error extracting text from selection:', error);
    return '';
  }
}

