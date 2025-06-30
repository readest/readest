import { create } from 'zustand';

interface ParallelViewState {
  parallelViews: Set<string>[];
  setParallel: (bookKeys: string[]) => void;
  unsetParallel: (bookKeys: string[]) => void;
  areParallels: (bookKey1: string, bookKey2: string) => boolean;
  getParallels: (bookKey: string) => Set<string> | null;
}

export const useParallelViewStore = create<ParallelViewState>((set, get) => ({
  parallelViews: [],

  setParallel: (bookKeys: string[]) => {
    set((state) => {
      const uniqueKeys = [...new Set(bookKeys.filter((key) => key.trim() !== ''))];
      if (uniqueKeys.length < 2) {
        return state;
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

      console.log('Set parallel groups:', newGroups);
      return { parallelViews: newGroups };
    });
  },
  unsetParallel: (bookKeys: string[]) => {
    set((state) => {
      const uniqueKeys = [...new Set(bookKeys.filter((key) => key.trim() !== ''))];
      if (uniqueKeys.length === 0) {
        return state;
      }

      const newGroups = [...state.parallelViews];
      const affectedGroups = newGroups.filter((group) => uniqueKeys.some((key) => group.has(key)));
      affectedGroups.forEach((group) => {
        uniqueKeys.forEach((key) => group.delete(key));
        if (group.size <= 1) {
          const index = newGroups.indexOf(group);
          if (index > -1) {
            newGroups.splice(index, 1);
          }
        }
      });

      console.log('Unset parallel groups:', newGroups);
      return { parallelViews: newGroups };
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
}));
