#!/usr/bin/env node
// Read-only account inspector for support tickets.
//
//   node --env-file=.env --env-file=.env.local scripts/db/inspect-accounts.mjs <email> [<email> ...]
//
// For each email: resolves the auth user, lists identities, counts every
// user-keyed table, dumps plans/payments, samples book titles (for ownership
// verification), and lists the user's objects in the R2 bucket. With two or
// more emails it also reports the book_hash / file overlap between accounts.
// Never writes anything.

import { createClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';

const SUPABASE_URL = atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64'] || '');
const ADMIN_KEY = process.env['SUPABASE_ADMIN_KEY'] || '';
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error('Missing NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64 or SUPABASE_ADMIN_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase());
if (emails.length === 0) {
  console.error('usage: inspect-accounts.mjs <email> [<email> ...]');
  process.exit(1);
}

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

const emailVariants = (email) => {
  const out = new Set([email]);
  if (email.endsWith('@gmail.com')) out.add(email.replace(/@gmail\.com$/, '@googlemail.com'));
  if (email.endsWith('@googlemail.com')) out.add(email.replace(/@googlemail\.com$/, '@gmail.com'));
  return [...out];
};

const gotrueFind = async (email) => {
  for (const candidate of emailVariants(email)) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(candidate)}&per_page=50`,
      { headers: { apikey: ADMIN_KEY, Authorization: `Bearer ${ADMIN_KEY}` } },
    );
    if (!res.ok) throw new Error(`GoTrue admin users: ${res.status} ${await res.text()}`);
    const { users } = await res.json();
    const exact = (users || []).filter((u) => (u.email || '').toLowerCase() === candidate);
    if (exact.length > 1) console.warn(`  ! ${exact.length} users share ${candidate}`);
    if (exact.length) return exact[0];
  }
  return null;
};

const count = async (table, userId, extra = (q) => q) => {
  const { count: n, error } = await extra(
    supabase.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId),
  );
  if (error) return `ERR ${error.message}`;
  return n ?? 0;
};

const listR2 = async (prefix) => {
  const accountId = process.env['R2_ACCOUNT_ID'];
  const bucket = process.env['R2_BUCKET_NAME'];
  if (!accountId || !bucket || !process.env['R2_ACCESS_KEY_ID']) return null;
  const client = new AwsClient({
    service: 's3',
    region: process.env['R2_REGION'] || 'auto',
    accessKeyId: process.env['R2_ACCESS_KEY_ID'],
    secretAccessKey: process.env['R2_SECRET_ACCESS_KEY'],
  });
  const objects = [];
  let token = '';
  do {
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('max-keys', '1000');
    if (token) url.searchParams.set('continuation-token', token);
    const res = await client.fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`R2 list ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '';
      const size = Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
      objects.push({ key: key.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"), size });
    }
    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '';
  } while (token);
  return objects;
};

const inspect = async (email) => {
  console.log(`\n${'='.repeat(78)}\n${email}\n${'='.repeat(78)}`);
  const user = await gotrueFind(email);
  if (!user) {
    console.log('  NO AUTH USER FOUND');
    return null;
  }
  const uid = user.id;
  console.log(`  user id           ${uid}`);
  console.log(`  auth email        ${user.email}${user.email_confirmed_at ? ' (confirmed)' : ' (UNCONFIRMED)'}`);
  console.log(`  created           ${user.created_at}`);
  console.log(`  last sign-in      ${user.last_sign_in_at}`);
  console.log(`  providers         ${JSON.stringify(user.app_metadata?.providers ?? user.app_metadata?.provider)}`);
  for (const id of user.identities || []) {
    console.log(
      `  identity          ${id.provider.padEnd(8)} ${id.identity_data?.email ?? ''}  last_sign_in ${id.last_sign_in_at}`,
    );
  }

  const notDeleted = (q) => q.is('deleted_at', null);
  const counts = {
    'books (live)': await count('books', uid, notDeleted),
    'books (deleted)': await count('books', uid, (q) => q.not('deleted_at', 'is', null)),
    book_configs: await count('book_configs', uid, notDeleted),
    'book_notes (live)': await count('book_notes', uid, notDeleted),
    'files (live)': await count('files', uid, notDeleted),
    'files (deleted)': await count('files', uid, (q) => q.not('deleted_at', 'is', null)),
    stat_books: await count('stat_books', uid),
    stat_pages: await count('stat_pages', uid),
    stat_archives: await count('stat_archives', uid),
    replicas: await count('replicas', uid),
    replica_keys: await count('replica_keys', uid),
    book_shares: await count('book_shares', uid),
    send_addresses: await count('send_addresses', uid),
    send_allowed_senders: await count('send_allowed_senders', uid),
    send_inbox: await count('send_inbox', uid),
    subscriptions: await count('subscriptions', uid),
    customers: await count('customers', uid),
  };
  console.log('\n  row counts');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(22)} ${v}`);

  const { data: plan } = await supabase.from('plans').select('*').eq('id', uid).maybeSingle();
  console.log('\n  plans row');
  if (!plan) console.log('    (none)');
  else
    for (const [k, v] of Object.entries(plan)) {
      const shown = /bytes$/.test(k) ? `${v} (${fmtBytes(v)})` : JSON.stringify(v);
      console.log(`    ${k.padEnd(28)} ${shown}`);
    }

  const { data: payments } = await supabase
    .from('payments')
    .select('id, provider, product_id, storage_gb, status, amount, currency, created_at, apple_original_transaction_id, google_purchase_token, metadata')
    .eq('user_id', uid)
    .order('created_at');
  console.log('\n  payments');
  if (!payments?.length) console.log('    (none)');
  for (const p of payments || []) {
    const tx = p.apple_original_transaction_id
      ? `apple_tx …${String(p.apple_original_transaction_id).slice(-6)}`
      : p.google_purchase_token
        ? 'google_token'
        : '';
    console.log(
      `    ${p.created_at}  ${p.provider.padEnd(8)} ${p.product_id}  ${p.storage_gb ?? 0} GB  ${p.status}  ${p.amount ?? ''} ${p.currency ?? ''}  ${tx}  ${p.metadata ? JSON.stringify(p.metadata) : ''}`,
    );
  }

  const { data: books } = await supabase
    .from('books')
    .select('book_hash, title, author, format, updated_at, uploaded_at, deleted_at')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false });
  const live = (books || []).filter((b) => !b.deleted_at);
  console.log(`\n  books (${live.length} live, showing up to 25, newest first)`);
  for (const b of live.slice(0, 25)) {
    console.log(`    ${b.updated_at?.slice(0, 10)}  ${(b.format || '').padEnd(5)} ${b.title}  —  ${b.author}${b.uploaded_at ? '  [uploaded]' : ''}`);
  }

  const { data: files } = await supabase
    .from('files')
    .select('file_key, file_size, book_hash, deleted_at')
    .eq('user_id', uid);
  const liveFiles = (files || []).filter((f) => !f.deleted_at);
  const liveBytes = liveFiles.reduce((s, f) => s + Number(f.file_size), 0);
  const wrongPrefix = liveFiles.filter((f) => !f.file_key.startsWith(`${uid}/`));
  console.log(`\n  files table: ${liveFiles.length} live rows, ${fmtBytes(liveBytes)}${wrongPrefix.length ? `, ${wrongPrefix.length} NOT under ${uid}/` : ''}`);
  for (const f of liveFiles.slice(0, 10)) {
    console.log(`    ${fmtBytes(f.file_size).padStart(10)}  ${f.file_key.replace(`${uid}/`, '')}`);
  }
  if (liveFiles.length > 10) console.log(`    … ${liveFiles.length - 10} more`);

  let r2 = null;
  try {
    r2 = await listR2(`${uid}/`);
  } catch (e) {
    console.log(`\n  R2: ${e.message}`);
  }
  if (r2) {
    const r2Bytes = r2.reduce((s, o) => s + o.size, 0);
    const fileKeys = new Set(liveFiles.map((f) => f.file_key));
    const untracked = r2.filter((o) => !fileKeys.has(o.key));
    const missing = liveFiles.filter((f) => !r2.some((o) => o.key === f.file_key));
    console.log(`\n  R2 objects under ${uid}/: ${r2.length}, ${fmtBytes(r2Bytes)}`);
    if (untracked.length) console.log(`    ${untracked.length} objects have no live files row (${fmtBytes(untracked.reduce((s, o) => s + o.size, 0))})`);
    if (missing.length) console.log(`    ${missing.length} live files rows have NO object in R2`);
  }

  return { user, uid, books: books || [], files: files || [], plan, payments: payments || [], r2 };
};

const results = [];
for (const email of emails) results.push(await inspect(email));

if (results.filter(Boolean).length >= 2) {
  console.log(`\n${'='.repeat(78)}\noverlap\n${'='.repeat(78)}`);
  const [a, b] = results.filter(Boolean);
  const aHashes = new Set(a.books.filter((x) => !x.deleted_at).map((x) => x.book_hash));
  const shared = b.books.filter((x) => !x.deleted_at && aHashes.has(x.book_hash));
  console.log(`  live book_hash in both accounts: ${shared.length}`);
  for (const s of shared) console.log(`    ${s.title} — ${s.author}`);
  const aNames = new Set(a.files.filter((f) => !f.deleted_at).map((f) => f.file_key.slice(a.uid.length + 1)));
  const sharedFiles = b.files.filter((f) => !f.deleted_at && aNames.has(f.file_key.slice(b.uid.length + 1)));
  console.log(`  same relative file key in both accounts: ${sharedFiles.length}`);
}
