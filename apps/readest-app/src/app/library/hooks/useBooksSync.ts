import { useCallback } from 'react';

export const useBooksSync = () => {
  const pullLibrary = useCallback(async (..._args: unknown[]) => {}, []);
  const pushLibrary = useCallback(async (..._args: unknown[]) => {}, []);

  return { pullLibrary, pushLibrary };
};
