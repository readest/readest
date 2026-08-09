import { create } from 'zustand';
import type {
  LocalSendDevice,
  LocalSendStatus,
  ReceiveRequest,
  TransferProgress,
} from '@/services/localsend/types';

interface OwnedSession {
  alias: string;
  progress: TransferProgress | null;
}

interface SendState {
  active: boolean;
  deviceAlias: string;
  progress: TransferProgress | null;
}

interface LocalSendStoreState {
  status: LocalSendStatus | null;
  devices: LocalSendDevice[];
  pendingRequest: ReceiveRequest | null;
  /**
   * Receive sessions this window accepted. Multi-window ownership: the window
   * whose respond call claimed the request ingests files and shows progress;
   * events for sessions not in this map are ignored.
   */
  ownedSessions: Record<string, OwnedSession>;
  sendState: SendState | null;
}

interface LocalSendStoreActions {
  setStatus: (status: LocalSendStatus | null) => void;
  setDevices: (devices: LocalSendDevice[]) => void;
  requestReceived: (request: ReceiveRequest) => void;
  requestClosed: (sessionId: string) => void;
  claimSession: (sessionId: string, alias: string) => void;
  receiveProgress: (progress: TransferProgress) => void;
  receiveEnded: (sessionId: string) => void;
  startSend: (deviceAlias: string) => void;
  sendProgress: (progress: TransferProgress) => void;
  sendEnded: () => void;
}

export const initialLocalSendState: LocalSendStoreState = {
  status: null,
  devices: [],
  pendingRequest: null,
  ownedSessions: {},
  sendState: null,
};

export const useLocalSendStore = create<LocalSendStoreState & LocalSendStoreActions>()(
  (set, get) => ({
    ...initialLocalSendState,
    setStatus: (status) => set({ status }),
    setDevices: (devices) => set({ devices }),
    requestReceived: (request) => set({ pendingRequest: request }),
    requestClosed: (sessionId) => {
      if (get().pendingRequest?.sessionId === sessionId) {
        set({ pendingRequest: null });
      }
    },
    claimSession: (sessionId, alias) =>
      set((state) => ({
        ownedSessions: {
          ...state.ownedSessions,
          [sessionId]: { alias, progress: null },
        },
      })),
    receiveProgress: (progress) => {
      const owned = get().ownedSessions[progress.sessionId];
      if (!owned) return;
      set((state) => ({
        ownedSessions: {
          ...state.ownedSessions,
          [progress.sessionId]: { ...owned, progress },
        },
      }));
    },
    receiveEnded: (sessionId) =>
      set((state) => {
        const { [sessionId]: _removed, ...rest } = state.ownedSessions;
        return { ownedSessions: rest };
      }),
    startSend: (deviceAlias) => set({ sendState: { active: true, deviceAlias, progress: null } }),
    sendProgress: (progress) => {
      const sendState = get().sendState;
      if (!sendState) return;
      set({ sendState: { ...sendState, progress } });
    },
    sendEnded: () => set({ sendState: null }),
  }),
);
