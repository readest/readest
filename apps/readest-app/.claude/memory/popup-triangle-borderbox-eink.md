---
name: popup-triangle-borderbox-eink
description: "E-ink popup pointer triangle rendered solid black when the popup sat above the selection - Popup.tsx measured contentRect (content box) so eink's 1px border made the popup land 2px low and triangleHidden demoted the white inner triangle; fix = measure borderBoxSize"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e76c53d-468e-4d5d-bdbd-485531f1bcb0
  modified: 2026-08-02T04:52:49.098Z
---

2026-08-02, reported from Android e-ink screenshots and reproduced on web Chrome (MERGED #5431): with the annotation toolbar ABOVE the selection, the pointer triangle under it was solid black in e-ink mode (correct = white with 1px black outline).

**Mechanism (all in `src/components/Popup.tsx`):** the outline is a black `.popup-triangle-outer` (z-50) under a white `.popup-triangle-inner` (z-50), offset 1px. `triangleHidden` demotes the inner to z-10 when the triangle point is inside the popup rect — in normal themes both triangles are the same color so the demotion is invisible; in e-ink the black outer wins → solid black. The demotion fired because the ResizeObserver measured `entry.contentRect.height` (content box), while eink's `eink:border` adds 1px borders: measured height 2px short → dir-'up' reposition put the popup bottom at point.y+2 → point "inside" (isPointInRect shrinks by only 1px). Fix: measure `entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height`.

**How to apply:** any layout math that positions an element by its own measured height must use border-box when eink (or any theme) adds borders; `contentRect` is never the rendered box. Debug shortcut: e-ink styling can be simulated in any browser by setting `document.documentElement.setAttribute('data-eink','true')` — no settings change needed. Test: `src/__tests__/components/popup-eink-triangle.test.tsx` (jsdom, browser-faithful RO entry with both contentRect and borderBoxSize). Related: [[css-style-fixes]]
