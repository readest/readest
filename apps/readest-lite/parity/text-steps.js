// `text:Label` steps, shared by both runners: every few hundred ms, the element on screen whose
// text (or aria-label) is exactly Label gets `data-parity-text="Label"`, which the runners tap as a
// selector (menu items and the like have no selector of their own): the smallest such control
// (button, link, menu item), else the smallest such element. Hidden panels keep their labels laid
// out, so a control comes first. An element is tagged once, so a page that doesn't change sees no
// more writes.
globalThis.__parityTexts = (texts) => {
  if (!texts.length) return;
  const tag = (globalThis.__parityTag = () => {
    for (const text of texts) {
      let best = null;
      let bestArea = Infinity;
      const controls = 'button, a, summary, [role="button"], [role="menuitem"]';
      const others = 'li, span, div, p, label, h1, h2, h3';
      const candidates = [...document.querySelectorAll(controls)];
      const firstOther = candidates.length;
      candidates.push(...document.querySelectorAll(others));
      for (const [i, el] of candidates.entries()) {
        if (i === firstOther && best) break; // a control was found
        const own = el.getAttribute('aria-label') ?? el.textContent?.trim();
        if (own !== text) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // Its centre on screen, where the tap goes: closed panels and menus are often laid out
        // outside the viewport.
        const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
        if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
        if (r.width * r.height < bestArea) [best, bestArea] = [el, r.width * r.height];
      }
      const old = document.querySelector(`[data-parity-text="${text.replace(/"/g, '\\"')}"]`);
      if (best && old !== best) {
        old?.removeAttribute('data-parity-text');
        best.setAttribute('data-parity-text', text);
      }
    }
  });
  setInterval(tag, 300);
};
