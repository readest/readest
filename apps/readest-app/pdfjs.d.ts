// `@pdfjs/*` resolves into `packages/foliate-js/node_modules/pdfjs-dist`, so
// nothing is copied into the app and nothing ships twice (Tauri embeds every
// published file). TypeScript will not infer types for JavaScript under
// node_modules, and pdfjs-dist ships its declarations as `pdf.d.mts` rather
// than the `pdf.min.d.mts` that would sit beside the minified build, so the
// module is declared here.
//
// Only the side effect matters: `document.ts` awaits this import to install
// pdf.js, and foliate-js drives it from plain JavaScript.
declare module '@pdfjs/pdf.min.mjs';
