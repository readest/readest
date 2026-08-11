import { beforeEach, describe, expect, it } from 'vitest';
import { initialLocalSendState, useLocalSendStore } from '@/store/localsendStore';
import type { ReceiveRequest, TransferProgress } from '@/services/localsend/types';

const request: ReceiveRequest = {
  sessionId: 's1',
  sender: { alias: 'Phone', deviceModel: null, deviceType: 'mobile', fingerprint: 'F' },
  files: [
    { id: 'f1', fileName: 'a.epub', size: 10, fileType: 'application/epub+zip', preview: null },
  ],
};
const progress: TransferProgress = {
  sessionId: 's1',
  bytesDone: 5,
  bytesTotal: 10,
  filesDone: 0,
  filesTotal: 1,
};

describe('localsendStore', () => {
  beforeEach(() => {
    useLocalSendStore.setState(initialLocalSendState);
  });

  it('tracks a request through claim, progress, and end', () => {
    const store = useLocalSendStore.getState();
    store.requestReceived(request);
    expect(useLocalSendStore.getState().pendingRequest?.sessionId).toBe('s1');
    store.claimSession('s1', 'Phone');
    store.requestClosed('s1');
    expect(useLocalSendStore.getState().pendingRequest).toBeNull();
    store.receiveProgress(progress);
    expect(useLocalSendStore.getState().ownedSessions['s1']?.progress?.bytesDone).toBe(5);
    store.receiveEnded('s1');
    expect(useLocalSendStore.getState().ownedSessions['s1']).toBeUndefined();
  });

  it('ignores progress for sessions this window does not own', () => {
    useLocalSendStore.getState().receiveProgress(progress);
    expect(useLocalSendStore.getState().ownedSessions['s1']).toBeUndefined();
  });

  it('requestClosed for another session keeps the pending request', () => {
    useLocalSendStore.getState().requestReceived(request);
    useLocalSendStore.getState().requestClosed('other');
    expect(useLocalSendStore.getState().pendingRequest?.sessionId).toBe('s1');
  });

  it('tracks send lifecycle', () => {
    const store = useLocalSendStore.getState();
    store.startSend('Laptop');
    expect(useLocalSendStore.getState().sendState?.deviceAlias).toBe('Laptop');
    store.sendProgress(progress);
    expect(useLocalSendStore.getState().sendState?.progress?.bytesDone).toBe(5);
    store.sendEnded();
    expect(useLocalSendStore.getState().sendState).toBeNull();
  });
});
