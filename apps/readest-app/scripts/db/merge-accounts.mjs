#!/usr/bin/env node
// Merge one Readest account's cloud data into another account of the SAME person.
//
//   node --env-file=.env --env-file=.env.local scripts/db/merge-accounts.mjs \
//     --from <losing email> --to <surviving email> [--apply]
//
// Dry run by default: prints exactly what would move and touches nothing.
// `--apply` performs the merge:
//   1. copies every R2 object under `<from>/` to `<to>/` (server-side
//      CopyObject) and verifies the copy's size;
//   2. re-points the user-keyed rows (books, book_configs, book_notes,
//      stat_books, stat_pages, replicas, files) at the surviving user — files
//      rows get their `file_key` prefix rewritten to match the copied object;
//   3. deletes the source objects once their rows point at the copies;
//   4. recomputes plans.storage_usage_bytes on BOTH users as the app would
//      (sum of live files.file_size).
//
// Policy decisions, all reported in the dry run:
//   * Same primary key on both sides (e.g. the same book_hash): the row with
//     the newer updated_at wins; a losing source row is left where it is.
//   * files rows whose object does not exist in R2 ("dangling") are NOT moved;
//     they are stale upload reservations and would only inflate the target's
//     quota. A moved books row loses its uploaded_at when no non-cover file
//     follows it, so the surviving account can upload the book again.
//   * payments / plans purchases / subscriptions / customers / send_* /
//     book_shares are NOT touched. Move a storage purchase with its own script.

import { createClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FROM = opt('--from')?.toLowerCase();
const TO = opt('--to')?.toLowerCase();
const APPLY = args.includes('--apply');
if (!FROM || !TO || FROM === TO) {
  console.error('usage: merge-accounts.mjs --from <email> --to <email> [--apply]');
  process.exit(1);
}

const SUPABASE_URL = atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64'] || '');
const ADMIN_KEY = process.env['SUPABASE_ADMIN_KEY'] || '';
const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID'] || '';
const R2_BUCKET = process.env['R2_BUCKET_NAME'] || '';
if (!SUPABASE_URL || !ADMIN_KEY || !R2_ACCOUNT_ID || !R2_BUCKET) {
  console.error('Missing Supabase or R2 env (run with --env-file=.env --env-file=.env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const r2 = new AwsClient({
  service: 's3',
  region: process.env['R2_REGION'] || 'auto',
  accessKeyId: process.env['R2_ACCESS_KEY_ID'],
  secretAccessKey: process.env['R2_SECRET_ACCESS_KEY'],
});
const R2_BASE = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

const fmtBytes = (n) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};
const die = (msg) => {
  console.error(`\nABORT: ${msg}`);
  process.exit(2);
};
const must = ({ data, error }, what) => {
  if (error) die(`${what}: ${error.message}`);
  return data;
};

// ---------------------------------------------------------------- resolve users
const findUser = async (email) => {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
    { headers: { apikey: ADMIN_KEY, Authorization: `Bearer ${ADMIN_KEY}` } },
  );
  if (!res.ok) die(`GoTrue admin users ${res.status}`);
  const { users } = await res.json();
  const exact = (users || []).filter((u) => (u.email || '').toLowerCase() === email);
  if (exact.length !== 1) die(`${exact.length} auth users match ${email}`);
  return exact[0];
};

const fromUser = await findUser(FROM);
const toUser = await findUser(TO);
const fromId = fromUser.id;
const toId = toUser.id;

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: merge ${FROM} -> ${TO}`);
console.log(`  from  ${fromId}  providers=${JSON.stringify(fromUser.app_metadata?.providers)}  last sign-in ${fromUser.last_sign_in_at}`);
console.log(`  to    ${toId}  providers=${JSON.stringify(toUser.app_metadata?.providers)}  last sign-in ${toUser.last_sign_in_at}`);

// ---------------------------------------------------------------- list R2
const listR2 = async (prefix) => {
  const out = new Map();
  let token = '';
  do {
    const url = new URL(R2_BASE);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('max-keys', '1000');
    if (token) url.searchParams.set('continuation-token', token);
    const res = await r2.fetch(url.toString(), { method: 'GET' });
    if (!res.ok) die(`R2 list ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const raw = m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '';
      const key = raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      out.set(key, Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0));
    }
    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '';
  } while (token);
  return out;
};

const fromObjects = await listR2(`${fromId}/`);
const toObjects = await listR2(`${toId}/`);

// ---------------------------------------------------------------- plan: files
const fromFiles = must(
  await supabase.from('files').select('id, file_key, file_size, book_hash, deleted_at').eq('user_id', fromId),
  'select files',
).filter((f) => !f.deleted_at);
const toFiles = must(
  await supabase.from('files').select('file_key').eq('user_id', toId).is('deleted_at', null),
  'select target files',
);
const toFileKeys = new Set(toFiles.map((f) => f.file_key));

const filePlan = { move: [], dangling: [], collide: [], badPrefix: [] };
for (const f of fromFiles) {
  if (!f.file_key.startsWith(`${fromId}/`)) {
    filePlan.badPrefix.push(f);
    continue;
  }
  const rel = f.file_key.slice(fromId.length + 1);
  const dest = `${toId}/${rel}`;
  const size = fromObjects.get(f.file_key);
  if (size === undefined) {
    filePlan.dangling.push(f);
  } else if (toFileKeys.has(dest) || toObjects.has(dest)) {
    filePlan.collide.push(f);
  } else {
    filePlan.move.push({ ...f, dest, objectSize: size });
  }
}
const orphanObjects = [...fromObjects.keys()].filter((k) => !fromFiles.some((f) => f.file_key === k));

// ---------------------------------------------------------------- plan: keyed tables
// newer updated_at wins on a primary-key collision
const planKeyed = async (table, keyCols, extraCols = []) => {
  const cols = ['updated_at', ...keyCols, ...extraCols].join(', ');
  const src = must(await supabase.from(table).select(cols).eq('user_id', fromId), `select ${table}`);
  const dst = must(await supabase.from(table).select(cols).eq('user_id', toId), `select target ${table}`);
  const keyOf = (r) => keyCols.map((c) => r[c]).join('|');
  const dstByKey = new Map(dst.map((r) => [keyOf(r), r]));
  const move = [];
  const skip = [];
  for (const r of src) {
    const other = dstByKey.get(keyOf(r));
    if (!other) move.push(r);
    else if (new Date(r.updated_at) > new Date(other.updated_at)) move.push({ ...r, replaces: other });
    else skip.push({ ...r, keptTarget: other });
  }
  return { table, keyCols, src, dst, move, skip };
};

const books = await planKeyed('books', ['book_hash'], ['title', 'author', 'uploaded_at', 'deleted_at']);
const configs = await planKeyed('book_configs', ['book_hash']);
const notes = await planKeyed('book_notes', ['book_hash', 'id']);
const statBooks = await planKeyed('stat_books', ['book_hash']);
const statPages = await planKeyed('stat_pages', ['book_hash', 'page', 'start_time']);
const replicas = must(
  await supabase.from('replicas').select('kind, replica_id, updated_at_ts').eq('user_id', fromId),
  'select replicas',
);
const toReplicas = must(
  await supabase.from('replicas').select('kind, replica_id').eq('user_id', toId),
  'select target replicas',
);
const replicaPlan = {
  move: replicas.filter((r) => !toReplicas.some((t) => t.kind === r.kind && t.replica_id === r.replica_id)),
  skip: replicas.filter((r) => toReplicas.some((t) => t.kind === r.kind && t.replica_id === r.replica_id)),
};

// books that will move flagged uploaded but whose real (non-cover) file is not following
const movedRelKeys = new Set(filePlan.move.map((f) => f.file_key.slice(fromId.length + 1)));
const hasRealFile = (hash) =>
  [...movedRelKeys].some((k) => k.includes(`/Books/${hash}/`) && !k.endsWith('/cover.png'));
const clearUploaded = books.move.filter((b) => b.uploaded_at && !b.deleted_at && !hasRealFile(b.book_hash));

// untouched tables, reported only
const untouched = {};
for (const t of ['book_shares', 'send_addresses', 'send_allowed_senders', 'send_inbox', 'subscriptions', 'customers', 'payments', 'stat_archives', 'replica_keys']) {
  const { count } = await supabase.from(t).select('*', { count: 'exact', head: true }).eq('user_id', fromId);
  untouched[t] = count ?? 0;
}

const fromPlan = must(await supabase.from('plans').select('*').eq('id', fromId).maybeSingle(), 'plans from');
const toPlan = must(await supabase.from('plans').select('*').eq('id', toId).maybeSingle(), 'plans to');
if (!toPlan) die(`${TO} has no plans row`);

// ---------------------------------------------------------------- report
const moveBytes = filePlan.move.reduce((s, f) => s + f.objectSize, 0);
const danglingBytes = filePlan.dangling.reduce((s, f) => s + Number(f.file_size), 0);
const toLiveBytes = must(
  await supabase.from('files').select('file_size').eq('user_id', toId).is('deleted_at', null),
  'target usage',
).reduce((s, f) => s + Number(f.file_size), 0);
const fromLiveBytes = fromFiles.reduce((s, f) => s + Number(f.file_size), 0);
const movedRowBytes = filePlan.move.reduce((s, f) => s + Number(f.file_size), 0);

console.log('\nR2 objects');
console.log(`  copy ${filePlan.move.length} objects, ${fmtBytes(moveBytes)}  (${fromId}/… -> ${toId}/…)`);
if (filePlan.collide.length) console.log(`  SKIP ${filePlan.collide.length} files rows: destination key already exists on target`);
if (filePlan.badPrefix.length) console.log(`  SKIP ${filePlan.badPrefix.length} files rows not under the source prefix`);
if (orphanObjects.length) console.log(`  leave ${orphanObjects.length} source objects with no live files row`);
console.log(`  leave ${filePlan.dangling.length} dangling files rows (${fmtBytes(danglingBytes)} of phantom usage, no object in R2):`);
for (const f of filePlan.dangling.slice(0, 60)) {
  const book = books.src.find((b) => b.book_hash === f.book_hash);
  console.log(`    ${fmtBytes(f.file_size).padStart(10)}  ${f.file_key.slice(fromId.length + 1)}  ${book ? `(${book.title})` : ''}`);
}

const report = (p) => {
  console.log(`\n${p.table}: move ${p.move.length} of ${p.src.length} rows (target has ${p.dst.length})`);
  for (const r of p.move.filter((x) => x.replaces)) console.log(`    replaces target row ${p.keyCols.map((c) => r[c]).join('/')} (source newer: ${r.updated_at} > ${r.replaces.updated_at})`);
  for (const r of p.skip) console.log(`    leave ${p.keyCols.map((c) => String(r[c]).slice(0, 40)).join('/')}${r.title ? ` "${r.title}"` : ''} (target newer or equal: ${r.keptTarget.updated_at} >= ${r.updated_at})`);
};
report(books);
if (clearUploaded.length) {
  console.log(`  clear uploaded_at on ${clearUploaded.length} moved books whose real file is not in R2:`);
  for (const b of clearUploaded) console.log(`    ${b.title} — ${b.author}`);
}
report(configs);
report(notes);
report(statBooks);
report(statPages);
console.log('  (book_configs / book_notes / stat_* rows are stamped updated_at = now() so target devices pull them)');
console.log(`\nreplicas: move ${replicaPlan.move.length} of ${replicas.length} rows${replicaPlan.skip.length ? `, leave ${replicaPlan.skip.length} (exists on target)` : ''}`);
console.log(`\nfiles: move ${filePlan.move.length} of ${fromFiles.length} live rows (rewrite file_key prefix)`);

console.log('\nuntouched on source (counts):');
console.log(`  ${Object.entries(untouched).map(([k, v]) => `${k}=${v}`).join('  ')}`);

const toAfter = toLiveBytes + movedRowBytes;
const fromAfter = fromLiveBytes - movedRowBytes;
const toQuota = 500 * 1024 * 1024 + Number(toPlan.storage_purchased_bytes || 0);
console.log('\nplans.storage_usage_bytes');
console.log(`  from  ${fmtBytes(fromPlan?.storage_usage_bytes)} -> ${fmtBytes(fromAfter)}  (purchased ${fmtBytes(fromPlan?.storage_purchased_bytes)})`);
console.log(`  to    ${fmtBytes(toPlan.storage_usage_bytes)} -> ${fmtBytes(toAfter)}  of ${fmtBytes(toQuota)} (${toPlan.plan} + purchased ${fmtBytes(toPlan.storage_purchased_bytes)})`);
if (toAfter > toQuota) console.log('  ! target would be OVER quota after the merge');

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to perform the merge.');
  process.exit(0);
}

// ---------------------------------------------------------------- apply
console.log('\n--- applying ---');

// 1. copy objects and verify
let copied = 0;
for (const f of filePlan.move) {
  const res = await r2.fetch(`${R2_BASE}/${encodeKey(f.dest)}`, {
    method: 'PUT',
    headers: { 'x-amz-copy-source': `/${R2_BUCKET}/${encodeKey(f.file_key)}` },
  });
  if (!res.ok) die(`copy ${f.file_key}: ${res.status} ${await res.text()}`);
  const head = await r2.fetch(`${R2_BASE}/${encodeKey(f.dest)}`, { method: 'HEAD' });
  const len = Number(head.headers.get('content-length'));
  if (!head.ok || len !== f.objectSize) die(`verify ${f.dest}: status ${head.status} size ${len} != ${f.objectSize}`);
  copied++;
  if (copied % 20 === 0) console.log(`  copied ${copied}/${filePlan.move.length}`);
}
console.log(`  copied and verified ${copied} objects`);

// 2. re-point rows
for (const f of filePlan.move) {
  must(
    await supabase.from('files').update({ user_id: toId, file_key: f.dest }).eq('id', f.id).eq('user_id', fromId).select('id'),
    `files ${f.id}`,
  );
}
console.log(`  files: ${filePlan.move.length} rows re-pointed`);

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// books pull on the trigger-bumped synced_at, so the re-point alone reaches
// every target device. configs/notes/stats pull on `updated_at > cursor`, so a
// device already signed into the target would never see a moved row that kept
// its old timestamp: stamp those now(), which is what the app's own stat
// pushes do anyway and, for configs/notes, only reaffirms the winning row.
const applyKeyed = async (p, patch = {}) => {
  let n = 0;
  // delete losing target rows first so the moved row can take the key
  for (const r of p.move.filter((x) => x.replaces)) {
    let q = supabase.from(p.table).delete().eq('user_id', toId);
    for (const c of p.keyCols) q = q.eq(c, r[c]);
    must(await q.select(p.keyCols[0]), `delete replaced ${p.table}`);
  }
  if (p.keyCols.length === 1) {
    const col = p.keyCols[0];
    for (const part of chunk(p.move, 200)) {
      const data = must(
        await supabase.from(p.table).update({ user_id: toId, ...patch }).eq('user_id', fromId).in(col, part.map((r) => r[col])).select(col),
        `update ${p.table}`,
      );
      n += data.length;
    }
  } else {
    for (const r of p.move) {
      let q = supabase.from(p.table).update({ user_id: toId, ...patch }).eq('user_id', fromId);
      for (const c of p.keyCols) q = q.eq(c, r[c]);
      n += must(await q.select(p.keyCols[0]), `update ${p.table}`).length;
    }
  }
  console.log(`  ${p.table}: ${n} rows re-pointed`);
  if (n !== p.move.length) die(`${p.table}: expected ${p.move.length} rows, updated ${n}`);
};

await applyKeyed(books);
if (clearUploaded.length) {
  must(
    await supabase.from('books').update({ uploaded_at: null }).eq('user_id', toId).in('book_hash', clearUploaded.map((b) => b.book_hash)).select('book_hash'),
    'clear uploaded_at',
  );
  console.log(`  books: uploaded_at cleared on ${clearUploaded.length} rows`);
}
const stamp = { updated_at: new Date().toISOString() };
await applyKeyed(configs, stamp);
await applyKeyed(notes, stamp);
await applyKeyed(statBooks, stamp);
await applyKeyed(statPages, stamp);
for (const r of replicaPlan.move) {
  must(
    await supabase.from('replicas').update({ user_id: toId }).eq('user_id', fromId).eq('kind', r.kind).eq('replica_id', r.replica_id).select('replica_id'),
    'update replicas',
  );
}
console.log(`  replicas: ${replicaPlan.move.length} rows re-pointed`);

// 3. delete source objects whose rows now point at the copies
let deleted = 0;
for (const f of filePlan.move) {
  const res = await r2.fetch(`${R2_BASE}/${encodeKey(f.file_key)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.warn(`  ! delete ${f.file_key}: ${res.status}`);
  else deleted++;
}
console.log(`  deleted ${deleted} source objects`);

// 4. recompute usage on both
const recompute = async (uid) => {
  const rows = must(await supabase.from('files').select('file_size').eq('user_id', uid).is('deleted_at', null), 'usage');
  const usage = rows.reduce((s, f) => s + Number(f.file_size), 0);
  must(await supabase.from('plans').update({ storage_usage_bytes: usage }).eq('id', uid).select('id'), 'plans update');
  return usage;
};
console.log(`  plans: from usage ${fmtBytes(await recompute(fromId))}, to usage ${fmtBytes(await recompute(toId))}`);
console.log('\nDone. Both accounts need a sign-out/sign-in before the app shows the new quota.');
