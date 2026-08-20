import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

// Parser for user-written annotation notes, shared by the sidebar note list
// and the annotation bubble popup so a note previews the same in both (#5785).
// A scoped instance: `.use()` mutates in place, and the export dialog still
// parses with the shared `marked` singleton.
const noteMarkdown = new Marked({ gfm: true }).use(
  markedKatex({
    // Bad math renders red inline with the error on hover instead of throwing.
    throwOnError: false,
    // The default emits MathML + HTML and needs katex.min.css to hide one; no
    // KaTeX stylesheet is loaded here, so equations would render twice.
    output: 'mathml',
    // The default needs a space before the opening `$`, so `word\n$x$` renders
    // as plain text with no error. Cost: `$5 and $10` is math (`\$` escapes).
    nonStandard: true,
  }),
);

// Notes reach dangerouslySetInnerHTML in the sidebar and the popup, and they
// can come from annotation imports and sync, not only the local editor, so the
// HTML is sanitized here once for both sinks. `utils/sanitize.ts#sanitizeHtml`
// is not reused: its tag allowlist has no MathML and would strip the KaTeX
// output, which the mathMl profile keeps.
export const parseNoteMarkdown = (note: string) =>
  DOMPurify.sanitize(noteMarkdown.parse(note, { async: false }), {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  });
