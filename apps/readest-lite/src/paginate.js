// Pagination for Readest Lite's reader on Blitz, which has no CSS multi-column layout (foliate-js's
// paginator needs it). A section is laid out once in an iframe exactly one page tall, so `%` and `vh`
// resolve against the page; `__n.subdocLines(iframe, url)` (blitz-qjs-script) returns its line boxes
// and replaced-element boxes, these are cut into pages here, and a page is shown by scrolling the
// sub-document to its start (`__n.subdocScroll(iframe, y)`) with the iframe clipped at its end:
// turning a page lays out nothing.

// Pages from line boxes: [contentHeight, top0, bottom0, ...] -> [[start, end], ...]. A page ends
// at the top of the first line that would not fit, unless nothing is on the page yet; a box taller
// than a page is sliced, except that a page holding only that box crops up to SLACK px of it (the
// strut under a page-tall image). Margins after the last box make no page.
const SLACK = 16;
export function paginate(r, pageHeight) {
  const boxes = [];
  for (let i = 1; i < r.length; i += 2) boxes.push([r[i], r[i + 1]]);
  boxes.sort((a, b) => a[0] - b[0]);
  const pages = [];
  let start = 0,
    filled = false,
    last = 0,
    limit = pageHeight;
  for (const [top, bottom] of boxes) {
    last = Math.max(last, bottom);
    if (bottom - start <= limit) {
      filled = true;
      continue;
    }
    if (!filled && bottom - start - pageHeight <= SLACK) {
      limit = bottom - start;
      filled = true;
      continue;
    }
    const end = filled && top > start ? top : start + pageHeight;
    pages.push([start, end]);
    start = end;
    limit = pageHeight;
    while (bottom - start > pageHeight) {
      pages.push([start, start + pageHeight]);
      start += pageHeight;
    }
    filled = bottom > start;
  }
  if (last > start + SLACK || !pages.length) pages.push([start, Math.max(r[0], start)]);
  return pages;
}
