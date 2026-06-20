import { createClient } from '@supabase/supabase-js';
import PostalMime from 'postal-mime';

interface Env {
  SEND_EMAIL_DOMAIN: string;
  MAX_MESSAGE_BYTES: string;
  INBOX_PENDING_LIMIT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INBOX_BUCKET: R2Bucket;
}

// Extensions Readest reads natively or converts client-side after import.
const ACCEPTED_EXTS = new Set([
  'epub',
  'mobi',
  'azw',
  'azw3',
  'fb2',
  'fbz',
  'zip',
  'cbz',
  'pdf',
  'txt',
  'docx',
  'rtf',
  'html',
  'htm',
]);

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const extensionOf = (filename: string): string =>
  filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';

/** First `#tag` token in an email subject (`my book #scifi` -> `scifi`). */
const parseSubjectTag = (subject: string | undefined): string | null => {
  if (!subject) return null;
  const match = subject.match(/#([\p{L}\p{N}_-]{1,40})/u);
  return match ? match[1]! : null;
};

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Resolve the recipient local part to a user.
    const localPart = message.to.split('@')[0]!.toLowerCase();
    const { data: addressRow } = await supabase
      .from('send_addresses')
      .select('user_id, enabled')
      .eq('address', localPart)
      .maybeSingle();
    if (!addressRow || !addressRow.enabled) {
      // Unknown address: reject silently — no backscatter to a guessed address.
      message.setReject('Unknown address');
      return;
    }
    const userId = addressRow.user_id as string;

    // 2. Anti-spoofing is enforced UPSTREAM by Cloudflare Email Routing, in
    // the SMTP session before this Worker ever runs: it requires SPF or DKIM
    // to pass, rejects per the sender's DMARC policy, and applies RBL + spam
    // scoring. The Worker therefore cannot (and need not) re-verify — Cloudflare
    // exposes no verdict header, and the `From` header is already trustworthy
    // by the time we see it. The approved-sender allowlist below is the gate.

    // 2a. Plan gate. Email-in is a paid feature (Plus / Pro / Lifetime).
    // We bounce — not silently drop — so a paid user who downgraded knows
    // their books aren't coming through and where to go. Mirror of the
    // server-API + client-UI gate; same plan-tier set as `EMAIL_IN_PLANS`
    // in `src/utils/access.ts`.
    const { data: planRow } = await supabase
      .from('plans')
      .select('plan')
      .eq('id', userId)
      .maybeSingle();
    const userPlan = ((planRow?.plan as string | undefined) || 'free').toLowerCase();
    if (!['plus', 'pro', 'purchase'].includes(userPlan)) {
      message.setReject(
        'Send-to-Readest email-in requires the Plus, Pro, or Lifetime plan. ' +
          'Open the Readest app to upgrade, or clip articles for free with the ' +
          'in-app Send button, the mobile Share menu, or the browser extension.',
      );
      return;
    }

    // 3. Size guard (Cloudflare's own ceiling is ~25-30 MB).
    const maxBytes = Number(env.MAX_MESSAGE_BYTES) || 26_214_400;
    if (message.rawSize > maxBytes) {
      message.setReject('Message too large — use the Send page for large files');
      return;
    }

    // 4. Parse the MIME message.
    const rawBuffer = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawBuffer);
    const fromEmail = normalizeEmail(parsed.from?.address ?? message.from);

    // 5. Approved-sender allowlist.
    const { data: senderRow } = await supabase
      .from('send_allowed_senders')
      .select('status')
      .eq('user_id', userId)
      .eq('email', fromEmail)
      .maybeSingle();
    if (!senderRow || senderRow.status !== 'approved') {
      if (!senderRow) {
        // Record the sender as pending so the user can approve it in settings.
        await supabase
          .from('send_allowed_senders')
          .insert({ user_id: userId, email: fromEmail, status: 'pending' });
      }
      message.setReject('Sender not approved — approve it in Readest settings');
      return;
    }

    // 6. Inbox quota — blunt a leaked-address flood. Count both pending and
    // claimed items: a crashed drainer can leave items stuck in `claimed`
    // until the lease expires, and those still occupy the inbox.
    const limit = Number(env.INBOX_PENDING_LIMIT) || 50;
    const { count } = await supabase
      .from('send_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['pending', 'claimed']);
    if ((count ?? 0) >= limit) {
      message.setReject('Inbox is full — open Readest to process pending items');
      return;
    }

    const subjectTag = parseSubjectTag(parsed.subject);

    // 7. Pick the first accepted attachment.
    const attachment = (parsed.attachments ?? []).find((a) =>
      ACCEPTED_EXTS.has(extensionOf(a.filename ?? '')),
    );

    if (attachment) {
      const inboxId = crypto.randomUUID();
      const filename = attachment.filename ?? 'document';
      const payloadKey = `inbox/${userId}/${inboxId}/${filename}`;
      const body =
        typeof attachment.content === 'string'
          ? new TextEncoder().encode(attachment.content)
          : new Uint8Array(attachment.content);
      await env.INBOX_BUCKET.put(payloadKey, body);
      const { error: insertError } = await supabase.from('send_inbox').insert({
        id: inboxId,
        user_id: userId,
        kind: 'file',
        source: 'email',
        payload_key: payloadKey,
        filename,
        subject_tag: subjectTag,
        byte_size: body.byteLength,
      });
      if (insertError) {
        // The inbox row is the source of truth; without it the R2 object is
        // an unreachable orphan. Delete it and reject so the sender retries.
        await env.INBOX_BUCKET.delete(payloadKey).catch(() => {});
        message.setReject('Could not queue the message — please retry');
      }
      return;
    }

    // 8. No attachment: treat a URL in the body as a read-later capture.
    const urlMatch = (parsed.text ?? '').match(/https?:\/\/\S+/);
    if (urlMatch) {
      const { error: insertError } = await supabase.from('send_inbox').insert({
        user_id: userId,
        kind: 'url',
        source: 'email',
        url: urlMatch[0],
        subject_tag: subjectTag,
      });
      if (insertError) {
        message.setReject('Could not queue the message — please retry');
      }
      return;
    }

    message.setReject('No supported attachment or link found');
  },
};
