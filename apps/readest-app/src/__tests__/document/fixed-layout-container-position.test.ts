import { describe, expect, it } from 'vitest';

// Importing the module registers the <foliate-fxl> custom element.
import 'foliate-js/fixed-layout.js';

describe('fixed-layout containerPosition (READEST-11)', () => {
  const FixedLayout = customElements.get('foliate-fxl');

  it('registers the custom element', () => {
    expect(FixedLayout).toBeTruthy();
  });

  it('exposes a writable containerPosition for scrolled fixed-layout autoscroll', () => {
    const descriptor = Object.getOwnPropertyDescriptor(FixedLayout!.prototype, 'containerPosition');
    expect(typeof descriptor?.get).toBe('function');
    // Auto Scroll / middle-click autoscroll do `renderer.containerPosition += delta`
    // in scrolled mode. A getter-only property crashed on the write for PDF / CBZ /
    // fixed-EPUB books in scrolled mode (READEST-11); the setter must exist.
    expect(typeof descriptor?.set).toBe('function');
  });
});
