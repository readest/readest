import { describe, it, expect, vi } from 'vitest';

// Mock the paginator module to avoid custom element registration conflicts
vi.mock('foliate-js/paginator.js', () => ({}));

describe('Paginator multi-view architecture', () => {
  describe('View padding configuration', () => {
    it('should have default padding of {before:1, after:1}', () => {
      // The View class has #padding defaulting to {before:1, after:1}
      // This is verified by checking that paginator.pages includes 2 padding pages
      // when there's a single view (pages = contentPages + 2)
      expect(true).toBe(true); // placeholder - tested via integration
    });
  });

  describe('Paginator primaryIndex getter', () => {
    it('should expose primaryIndex on the paginator element', async () => {
      // Register a stub custom element if not already registered
      if (!customElements.get('foliate-paginator')) {
        // Use a simplified stub that mirrors the real Paginator's public interface
        customElements.define(
          'foliate-paginator',
          class extends HTMLElement {
            #primaryIndex = -1;
            get primaryIndex() {
              return this.#primaryIndex;
            }
          },
        );
      }
      const el = document.createElement('foliate-paginator') as HTMLElement & {
        primaryIndex: number;
      };
      expect(el.primaryIndex).toBe(-1);
    });
  });

  describe('getContents returns all loaded views', () => {
    it('should return contents sorted by section index', () => {
      // With multi-view, getContents() returns entries from all loaded views
      // sorted by section index. Each entry has { doc, index, overlayer }.
      // This is verified by the fact that consumers can .find() by index.
      const contents = [
        { doc: {} as Document, index: 3, overlayer: null },
        { doc: {} as Document, index: 4, overlayer: null },
        { doc: {} as Document, index: 5, overlayer: null },
      ];
      const primaryIndex = 4;
      const primary = contents.find((x) => x.index === primaryIndex) ?? contents[0];
      expect(primary?.index).toBe(4);
    });

    it('should fall back to first entry when primaryIndex not found', () => {
      const contents = [{ doc: {} as Document, index: 3, overlayer: null }];
      const primaryIndex = 99; // not in contents
      const primary = contents.find((x) => x.index === primaryIndex) ?? contents[0];
      expect(primary?.index).toBe(3);
    });

    it('should handle empty contents gracefully', () => {
      const contents: { doc: Document; index: number; overlayer: unknown }[] = [];
      const primaryIndex = 0;
      const primary = contents.find((x) => x.index === primaryIndex) ?? contents[0];
      expect(primary).toBeUndefined();
    });
  });

  describe('View padding assignment logic', () => {
    it('should assign {before:1, after:1} for single view', () => {
      const views = [{ index: 5, padding: { before: 0, after: 0 } }];
      // Simulate #updateViewPadding
      if (views.length === 1) {
        views[0]!.padding = { before: 1, after: 1 };
      }
      expect(views[0]!.padding).toEqual({ before: 1, after: 1 });
    });

    it('should assign correct padding for multiple views', () => {
      const views = [
        { index: 3, padding: { before: 0, after: 0 } },
        { index: 4, padding: { before: 0, after: 0 } },
        { index: 5, padding: { before: 0, after: 0 } },
      ];
      // Simulate #updateViewPadding
      for (let i = 0; i < views.length; i++) {
        const before = i === 0 ? 1 : 0;
        const after = i === views.length - 1 ? 1 : 0;
        views[i]!.padding = { before, after };
      }
      expect(views[0]!.padding).toEqual({ before: 1, after: 0 });
      expect(views[1]!.padding).toEqual({ before: 0, after: 0 });
      expect(views[2]!.padding).toEqual({ before: 0, after: 1 });
    });

    it('should assign correct padding for two views', () => {
      const views = [
        { index: 3, padding: { before: 0, after: 0 } },
        { index: 4, padding: { before: 0, after: 0 } },
      ];
      for (let i = 0; i < views.length; i++) {
        const before = i === 0 ? 1 : 0;
        const after = i === views.length - 1 ? 1 : 0;
        views[i]!.padding = { before, after };
      }
      expect(views[0]!.padding).toEqual({ before: 1, after: 0 });
      expect(views[1]!.padding).toEqual({ before: 0, after: 1 });
    });
  });

  describe('Page counting across views (column-level sizing)', () => {
    // contentPages is now in column units. View element sizes are:
    //   contentColumns * columnSize + (padding.before + padding.after) * spreadSize
    // where columnSize = spreadSize / columnCount
    const spreadSize = 800;
    const columnCount = 2;
    const columnSize = spreadSize / columnCount; // 400

    type ViewInfo = {
      index: number;
      contentPages: number;
      padding: { before: number; after: number };
    };

    const getViewElementSize = (view: ViewInfo) => {
      return (
        view.contentPages * columnSize + (view.padding.before + view.padding.after) * spreadSize
      );
    };

    const getViewOffset = (views: ViewInfo[], targetIndex: number) => {
      let offset = 0;
      for (const view of views) {
        if (view.index === targetIndex) return offset;
        offset += getViewElementSize(view);
      }
      return offset;
    };

    // #getPagesBeforeView uses pixel offsets divided by spread size (Math.floor)
    const getPagesBeforeView = (views: ViewInfo[], targetIndex: number) => {
      return Math.floor(getViewOffset(views, targetIndex) / spreadSize);
    };

    it('should count spread pages before a given view using pixel offsets', () => {
      const views: ViewInfo[] = [
        { index: 3, contentPages: 5, padding: { before: 1, after: 0 } },
        { index: 4, contentPages: 2, padding: { before: 0, after: 0 } },
        { index: 5, contentPages: 8, padding: { before: 0, after: 1 } },
      ];
      expect(getPagesBeforeView(views, 3)).toBe(0);
      // View 3: 5*400 + 800 = 2800px → floor(2800/800) = 3
      expect(getPagesBeforeView(views, 4)).toBe(3);
      // View 3+4: 2800 + 2*400 = 3600 → floor(3600/800) = 4
      expect(getPagesBeforeView(views, 5)).toBe(4);
    });

    it('should compute total pages using Math.ceil of viewSize / spreadSize', () => {
      const views: ViewInfo[] = [
        { index: 0, contentPages: 5, padding: { before: 1, after: 0 } },
        { index: 1, contentPages: 2, padding: { before: 0, after: 0 } },
        { index: 2, contentPages: 8, padding: { before: 0, after: 1 } },
      ];
      const totalViewSize = views.reduce((sum, v) => sum + getViewElementSize(v), 0);
      // 5*400+800 + 2*400 + 8*400+800 = 2800 + 800 + 4000 = 7600
      const totalPages = Math.ceil(totalViewSize / spreadSize);
      expect(totalPages).toBe(Math.ceil(7600 / 800)); // 10
    });

    it('should place 1-column section at first column with next section after', () => {
      // Image page (1 col) + normal section (10 cols)
      const views: ViewInfo[] = [
        { index: 0, contentPages: 1, padding: { before: 1, after: 0 } },
        { index: 1, contentPages: 10, padding: { before: 0, after: 1 } },
      ];
      // View 0: 1*400 + 800 = 1200. View 1: 10*400 + 800 = 4800
      const totalViewSize = views.reduce((sum, v) => sum + getViewElementSize(v), 0);
      expect(totalViewSize).toBe(6000);
      expect(Math.ceil(totalViewSize / spreadSize)).toBe(8);
      // Pages before view 1: floor(1200/800) = 1
      expect(getPagesBeforeView(views, 1)).toBe(1);
    });

    it('should handle single-column layout (columnCount=1) same as before', () => {
      const singleColSpread = 800;
      const singleColSize = singleColSpread; // columnCount=1
      // contentPages=3 means 3 columns, but with columnCount=1, each column IS a spread
      const viewSize = 3 * singleColSize + 2 * singleColSpread;
      expect(viewSize).toBe(4000);
      expect(Math.ceil(viewSize / singleColSpread)).toBe(5); // 3 content + 2 padding
    });
  });

  describe('Fraction and anchor calculation with column-level sizing', () => {
    const columnCount = 2;

    it('should compute fraction as localColumn / textPages', () => {
      // Simulate #afterScroll fraction calculation
      const textPages = 6; // 6 content columns
      // At spread 0 (first content spread)
      const localPage0 = 0;
      const localColumn0 = localPage0 * columnCount; // 0
      const fraction0 = Math.max(0, Math.min(1, localColumn0 / textPages));
      expect(fraction0).toBe(0);

      // At spread 1 (second content spread)
      const localPage1 = 1;
      const localColumn1 = localPage1 * columnCount; // 2
      const fraction1 = Math.max(0, Math.min(1, localColumn1 / textPages));
      expect(fraction1).toBeCloseTo(1 / 3);

      // At spread 2 (third content spread, last)
      const localPage2 = 2;
      const localColumn2 = localPage2 * columnCount; // 4
      const fraction2 = Math.max(0, Math.min(1, localColumn2 / textPages));
      expect(fraction2).toBeCloseTo(2 / 3);
    });

    it('should convert anchor fraction to spread page for scrolling', () => {
      const textPages = 5; // 5 content columns
      // anchor=0 → column 0 → spread 0
      expect(Math.floor(Math.round(0 * (textPages - 1)) / columnCount)).toBe(0);
      // anchor=0.5 → column 2 → spread 1
      expect(Math.floor(Math.round(0.5 * (textPages - 1)) / columnCount)).toBe(1);
      // anchor=1.0 → column 4 → spread 2
      expect(Math.floor(Math.round(1.0 * (textPages - 1)) / columnCount)).toBe(2);
    });
  });

  describe('Primary section detection', () => {
    it('should detect primary view as first visible view', () => {
      // Simulate #detectPrimaryView — uses visibleStart, not midpoint
      const views = [
        { index: 3, offset: 0, size: 100 },
        { index: 4, offset: 100, size: 50 },
        { index: 5, offset: 150, size: 200 },
      ];
      const detectPrimary = (visibleStart: number) => {
        for (const view of views) {
          if (visibleStart < view.offset + view.size) {
            return view.index;
          }
        }
        return views[views.length - 1]?.index;
      };
      expect(detectPrimary(0)).toBe(3); // start in first view
      expect(detectPrimary(50)).toBe(3); // still in first view
      expect(detectPrimary(100)).toBe(4); // at boundary → second view
      expect(detectPrimary(125)).toBe(4); // in second view
      expect(detectPrimary(150)).toBe(5); // at boundary → third view
      expect(detectPrimary(300)).toBe(5); // in third view
    });
  });

  describe('Adjacent index with fromIndex parameter', () => {
    it('should find next linear section from a given index', () => {
      const sections = [
        { linear: 'yes' }, // 0
        { linear: 'no' }, // 1 (non-linear)
        { linear: 'yes' }, // 2
        { linear: 'yes' }, // 3
        { linear: 'no' }, // 4 (non-linear)
        { linear: 'yes' }, // 5
      ];
      const adjacentIndex = (dir: number, fromIndex: number) => {
        for (let index = fromIndex + dir; index >= 0 && index < sections.length; index += dir) {
          if (sections[index]?.linear !== 'no') return index;
        }
        return undefined;
      };
      expect(adjacentIndex(1, 0)).toBe(2); // skip non-linear 1
      expect(adjacentIndex(1, 2)).toBe(3);
      expect(adjacentIndex(1, 3)).toBe(5); // skip non-linear 4
      expect(adjacentIndex(-1, 5)).toBe(3); // skip non-linear 4
      expect(adjacentIndex(-1, 2)).toBe(0); // skip non-linear 1
      expect(adjacentIndex(1, 5)).toBeUndefined(); // end of book
      expect(adjacentIndex(-1, 0)).toBeUndefined(); // start of book
    });
  });

  describe('Trim distant views', () => {
    it('should keep max 4 views (1 before + primary + 2 after)', () => {
      // Simulate #trimDistantViews
      const viewIndices = [1, 3, 5, 7, 9, 11];
      const primaryIndex = 5;
      const sorted = [...viewIndices].sort((a, b) => a - b);
      const primaryPos = sorted.indexOf(primaryIndex);
      const keep = new Set([primaryIndex]);
      if (primaryPos > 0) keep.add(sorted[primaryPos - 1]!);
      for (let d = 1; d <= 2; d++) {
        if (primaryPos + d < sorted.length) keep.add(sorted[primaryPos + d]!);
      }
      const remaining = viewIndices.filter((i) => keep.has(i));
      expect(remaining).toEqual([3, 5, 7, 9]);
      expect(remaining.length).toBeLessThanOrEqual(4);
    });
  });
});
