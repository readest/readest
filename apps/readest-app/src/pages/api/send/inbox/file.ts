import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject, putObject } from '@/utils/object';
import { parseSubjectTag } from '@/services/send/sendAddress';
import {
  SEND_INBOX_BUCKET,
  SEND_INBOX_FILE_MAX_BYTES,
  SEND_INBOX_PENDING_LIMIT,
} from '@/services/constants';

/**
 * `kind='file'` inbox endpoint for the browser extension. The extension
 * builds a self-contained EPUB on the user's machine (Readability +
 * inlined images + bundled stylesheet) and uploads it as the request body.
 *
 * Lives at its own path — `pages/api/send/inbox.ts` keeps the JSON
 * bodyParser, but a binary upload needs `bodyParser: false` and a manual
 * stream read.
 *
 * Drainer behaviour matches the email-attachment path: the payload is
 * stored verbatim in the inbox R2 bucket, the row carries `kind='file'`,
 * and the drainer imports the EPUB on the next open without any further
 * conversion.
 */
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2000;
const ALLOWED_MIME = new Set(['application/epub+zip', 'application/octet-stream']);

function header(req: NextApiRequest, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function decodeRfc5987(value: string): string {
  // `X-Readest-Title: UTF-8''Spa%C3%9F`. Used so non-ASCII titles survive
  // the HTTP-header transport without arbitrary client encoding.
  const m = value.match(/^UTF-8''(.+)$/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return '';
    }
  }
  return value;
}

async function readBody(req: NextApiRequest, max: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > max) {
        reject(Object.assign(new Error('Payload too large'), { code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user } = await validateUserAndToken(req.headers['authorization']);
  if (!user) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const contentType = header(req, 'content-type') ?? '';
  const baseType = contentType.split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.has(baseType)) {
    return res.status(415).json({ error: 'Unsupported content type' });
  }

  const titleRaw = header(req, 'x-readest-title');
  const urlRaw = header(req, 'x-readest-url');
  const title = titleRaw ? decodeRfc5987(titleRaw).slice(0, MAX_TITLE_LENGTH) : null;
  const sourceUrl = urlRaw ? decodeRfc5987(urlRaw).slice(0, MAX_URL_LENGTH) : null;

  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    return res.status(400).json({ error: 'Invalid source URL' });
  }

  const supabase = createSupabaseAdminClient();

  // Same anti-abuse cap as the JSON inbox endpoint: a leaked token can't
  // flood R2 once the user has too many pending items.
  const { count, error: countError } = await supabase
    .from('send_inbox')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['pending', 'claimed']);
  if (countError) {
    return res.status(500).json({ error: countError.message });
  }
  if ((count ?? 0) >= SEND_INBOX_PENDING_LIMIT) {
    return res.status(429).json({ error: 'Inbox is full — open Readest to process pending items' });
  }

  let body: Buffer;
  try {
    body = await readBody(req, SEND_INBOX_FILE_MAX_BYTES);
  } catch (err) {
    if ((err as { code?: string }).code === 'payload_too_large') {
      return res.status(413).json({ error: 'File is too large' });
    }
    return res.status(400).json({ error: 'Could not read request body' });
  }
  if (body.byteLength === 0) {
    return res.status(400).json({ error: 'Empty file' });
  }

  const { data: row, error: rowError } = await supabase
    .from('send_inbox')
    .insert({
      user_id: user.id,
      kind: 'file',
      source: 'extension',
      url: sourceUrl,
      filename: title,
      byte_size: body.byteLength,
      subject_tag: parseSubjectTag(title) ?? null,
    })
    .select('id')
    .single<{ id: string }>();
  if (rowError) return res.status(500).json({ error: rowError.message });

  const payloadKey = `inbox/${user.id}/${row.id}/clip.epub`;
  // Allocate a fresh ArrayBuffer so we don't accidentally hand a
  // SharedArrayBuffer-typed view to the S3 client, which expects an
  // owned ArrayBuffer.
  const payloadBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(payloadBuffer).set(body);
  try {
    await putObject(payloadKey, payloadBuffer, 'application/epub+zip', SEND_INBOX_BUCKET);
  } catch (err) {
    // Roll back the row so we never leave a `pending` item the drainer
    // would only fail on.
    await supabase.from('send_inbox').delete().eq('id', row.id);
    console.error('Inbox file upload failed:', err);
    return res.status(500).json({ error: 'Could not store EPUB' });
  }

  const { error: updateError } = await supabase
    .from('send_inbox')
    .update({ payload_key: payloadKey })
    .eq('id', row.id);
  if (updateError) {
    await supabase.from('send_inbox').delete().eq('id', row.id);
    try {
      await deleteObject(payloadKey, SEND_INBOX_BUCKET);
    } catch (err) {
      console.warn('Inbox file payload cleanup failed:', err);
    }
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({ id: row.id });
}
