// The app's CSP lists script hashes, so 'unsafe-inline' no longer covers a
// book's inline event handlers (onload, onclick, ...): the webview refuses
// them and the handler property reads null. Compile each refused one with the
// section window's Function, which 'unsafe-eval' allows, so a scripted book
// works with Allow JavaScript (#7769).
export const bindInlineEventHandlers = (doc: Document) => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) return;
  let refusedLoad = false;
  for (const el of doc.querySelectorAll('*')) {
    const handlers = el as unknown as Record<string, unknown>;
    for (const { name, value } of Array.from(el.attributes)) {
      if (!name.startsWith('on') || !(name in el) || handlers[name] !== null) continue;
      try {
        handlers[name] = new win.Function('event', value);
      } catch (error) {
        console.error(`Invalid inline ${name} handler:`, error);
        continue;
      }
      if (el === doc.body && name === 'onload') refusedLoad = true;
    }
  }
  // The section has already loaded, so its body's load handler runs here.
  // Like a dispatched event, an error in it stays with the book.
  if (!refusedLoad) return;
  try {
    win.onload?.call(win, new win.Event('load'));
  } catch (error) {
    console.error('Error in inline onload handler:', error);
  }
};
