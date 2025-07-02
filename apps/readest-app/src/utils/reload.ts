import { RELOAD_BEFORE_SAVED_TIMEOUT_MS } from '@/services/constants';
import { eventDispatcher } from './event';

export const saveAndReload = async () => {
  await eventDispatcher.dispatch('beforereload');
  setTimeout(() => window.location.reload(), RELOAD_BEFORE_SAVED_TIMEOUT_MS);
};
