// TTS reads sections that are not currently rendered through
// section.createDocument(), which parses the raw resource and bypasses the
// book loader's 'data' event where the display transformers (proofread,
// simplecc, punctuation, ...) run. Speech then diverges from the displayed
// text, and highlight CFIs computed on the raw document anchor at wrong
// offsets in the transformed live document once a proofread rule adds or
// deletes text (#5406). This helper replays the exact same 'data' pipeline
// over a raw section document so TTS documents are content-identical to what
// the reader displays. Books without a transformTarget (whose display is not
// transformed either) pass through unchanged.
export const transformTTSSectionDocument = async (
  book: { transformTarget?: EventTarget },
  sectionId: string | undefined,
  doc: Document,
): Promise<Document> => {
  const target = book.transformTarget;
  if (!target) return doc;
  try {
    const type = doc.contentType || 'application/xhtml+xml';
    const data = new XMLSerializer().serializeToString(doc);
    const detail: { data: string | Promise<string>; type: string } = { data, type };
    // Readonly, mirroring foliate's Loader.createURL dispatch; the reader's
    // transform handler keys selection-scoped proofread rules off this name.
    Object.defineProperty(detail, 'name', {
      value: typeof sectionId === 'string' ? sectionId : '',
    });
    target.dispatchEvent(new CustomEvent('data', { detail }));
    const transformed = await detail.data;
    // '' is the transform handler's error fallback; identical output means no
    // transformer touched the content, so the reparse can be skipped.
    if (typeof transformed !== 'string' || !transformed || transformed === data) return doc;
    const newDoc = new DOMParser().parseFromString(transformed, type as DOMParserSupportedType);
    if (!newDoc.documentElement || newDoc.querySelector('parsererror')) return doc;
    return newDoc;
  } catch {
    return doc;
  }
};
