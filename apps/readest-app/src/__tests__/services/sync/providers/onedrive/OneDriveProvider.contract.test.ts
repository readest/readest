import { runSemanticContract, type ProviderScenario } from '../../file/providerSemanticContract';
import {
  createOneDriveProvider,
  type FetchFn,
} from '@/services/sync/providers/onedrive/OneDriveProvider';

runSemanticContract('OneDrive', (): ProviderScenario => {
  let status = 200;
  let body = '';
  const fetchFn = (async () =>
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as FetchFn;
  return {
    makeProvider: () =>
      createOneDriveProvider({ getAccessToken: async () => 'T' }, fetchFn, {
        sleep: () => Promise.resolve(),
      }),
    stageAbsent: () => {
      status = 404;
      body = JSON.stringify({ error: { code: 'itemNotFound' } });
    },
    stageAuthFailure: () => {
      status = 401;
      body = JSON.stringify({ error: { code: 'unauthenticated' } });
    },
  };
});
