import { create } from 'zustand';

interface ParallelViewState {
  parallelViews: Set<string>[];
  // The section each book was on when Enter Parallel Sync linked it. Linked
  // books keep that gap, so one book open twice can show two of its parts side
  // by side (#4991). Books with none sync to the same section.
  sectionAnchors: Record<string, number>;
  setParallel: (bookKeys: string[], sectionAnchors?: Record<string, number>) => void;
  unsetParallel: (bookKeys: string[]) => void;
  areParallels: (bookKey1: string, bookKey2: string) => boolean;
  getParallels: (bookKey: string) => Set<string> | null;
  getSectionOffset: (fromBookKey: string, toBookKey: string) => number;
}

export const useParallelViewStore = create<ParallelViewState>((set, get) => ({
  parallelViews: [],
  sectionAnchors: {},

  setParallel: (bookKeys: string[], sectionAnchors?: Record<string, number>) => {
    set((state) => {
      const uniqueKeys = [...new Set(bookKeys.filter((key) => key.trim() !== ''))];
      if (uniqueKeys.length < 2) {
        return state;
      }

      const anchors = { ...state.sectionAnchors, ...sectionAnchors };
      // A book opened next to a linked one follows that book's section.
      const anchored = uniqueKeys.find((key) => key in anchors);
      if (anchored) {
        const section = anchors[anchored]!;
        uniqueKeys.forEach((key) => {
          anchors[key] ??= section;
        });
      }

      const newGroups = [...state.parallelViews];
      const existingGroups = newGroups.filter((group) => uniqueKeys.some((key) => group.has(key)));

      let targetGroup: Set<string>;
      if (existingGroups.length === 0) {
        targetGroup = new Set(uniqueKeys);
        newGroups.push(targetGroup);
      } else if (existingGroups.length === 1) {
        targetGroup = existingGroups[0]!;
        uniqueKeys.forEach((key) => targetGroup.add(key));
      } else {
        targetGroup = existingGroups[0]!;
        existingGroups.slice(1).forEach((group) => {
          group.forEach((key) => targetGroup.add(key));
          const index = newGroups.indexOf(group);
          if (index > -1) {
            newGroups.splice(index, 1);
          }
        });
        uniqueKeys.forEach((key) => targetGroup.add(key));
      }

      return { parallelViews: newGroups, sectionAnchors: anchors };
    });
  },
  unsetParallel: (bookKeys: string[]) => {
    set((state) => {
      const uniqueKeys = [...new Set(bookKeys.filter((key) => key.trim() !== ''))];
      if (uniqueKeys.length === 0) {
        return state;
      }

      const newGroups = [...state.parallelViews];
      const anchors = { ...state.sectionAnchors };
      const affectedGroups = newGroups.filter((group) => uniqueKeys.some((key) => group.has(key)));
      affectedGroups.forEach((group) => {
        uniqueKeys.forEach((key) => {
          group.delete(key);
          delete anchors[key];
        });
        if (group.size <= 1) {
          group.forEach((key) => delete anchors[key]);
          const index = newGroups.indexOf(group);
          if (index > -1) {
            newGroups.splice(index, 1);
          }
        }
      });

      return { parallelViews: newGroups, sectionAnchors: anchors };
    });
  },

  areParallels(bookKey1, bookKey2) {
    const { parallelViews } = get();
    return parallelViews.some((group) => group.has(bookKey1) && group.has(bookKey2));
  },

  getParallels(bookKey) {
    const { parallelViews } = get();
    return parallelViews.find((group) => group.has(bookKey)) || null;
  },

  getSectionOffset(fromBookKey, toBookKey) {
    const { sectionAnchors } = get();
    return (sectionAnchors[toBookKey] ?? 0) - (sectionAnchors[fromBookKey] ?? 0);
  },
}));
