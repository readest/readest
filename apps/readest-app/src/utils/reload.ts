import { RELOAD_BEFORE_SAVED_TIMEOUT_MS } from '@/services/constants';

export const saveAndReload = async () => {
  setTimeout(() => window.location.reload(), RELOAD_BEFORE_SAVED_TIMEOUT_MS);
};
