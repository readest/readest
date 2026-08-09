export interface LocalSendStatus {
  running: boolean;
  alias: string;
  port: number;
  fingerprint: string;
  multicastError: string | null;
}

export interface LocalSendDevice {
  alias: string;
  deviceModel: string | null;
  deviceType: string | null;
  fingerprint: string;
  host: string;
  port: number;
  protocol: string;
}

export interface LocalSendFile {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
}

export interface ReceiveRequest {
  sessionId: string;
  sender: {
    alias: string;
    deviceModel: string | null;
    deviceType: string | null;
    fingerprint: string;
  };
  files: LocalSendFile[];
}

export interface TransferProgress {
  sessionId: string;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

export interface ReceiveFileDone {
  sessionId: string;
  fileId: string;
  fileName: string;
  path: string | null;
  error: string | null;
}

export interface ReceiveEnd {
  sessionId: string;
  reason: 'finished' | 'cancelled';
  received: number;
  failed: number;
}

export interface SendEnd {
  sessionId: string | null;
  status: 'sent' | 'declined' | 'cancelled' | 'error';
  error: string | null;
  filesSent: number;
}

export interface SendFileInput {
  path: string;
  fileName: string;
  mimeType: string;
}

export const LOCALSEND_EVENTS = {
  serverState: 'localsend:server-state',
  devices: 'localsend:devices',
  receiveRequest: 'localsend:receive-request',
  receiveRequestClosed: 'localsend:receive-request-closed',
  receiveProgress: 'localsend:receive-progress',
  receiveFileDone: 'localsend:receive-file-done',
  receiveEnd: 'localsend:receive-end',
  sendProgress: 'localsend:send-progress',
  sendEnd: 'localsend:send-end',
} as const;
