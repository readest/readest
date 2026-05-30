// TypeScript mirrors of the Send to Readest tables in
// docker/volumes/db/init/schema.sql.

export interface DBSendAddress {
  user_id: string;
  address: string;
  enabled: boolean;
  created_at: string;
  rotated_at: string | null;
}

export type SendSenderStatus = 'approved' | 'pending';

export interface DBSendAllowedSender {
  id: string;
  user_id: string;
  email: string;
  status: SendSenderStatus;
  created_at: string;
}

export type SendInboxKind = 'file' | 'url' | 'html';
export type SendInboxSource = 'email' | 'extension';
export type SendInboxStatus = 'pending' | 'claimed' | 'done' | 'failed';

export interface DBSendInboxItem {
  id: string;
  user_id: string;
  kind: SendInboxKind;
  source: SendInboxSource;
  payload_key: string | null;
  url: string | null;
  filename: string | null;
  subject_tag: string | null;
  byte_size: number;
  status: SendInboxStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}
