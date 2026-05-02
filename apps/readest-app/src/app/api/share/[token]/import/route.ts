import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { copyObject, objectExists } from '@/utils/object';
import {
  STORAGE_QUOTA_GRACE_BYTES,
  getStoragePlanData,
  validateUserAndToken,
} from '@/utils/access';
import { rejectionToHttp, resolveActiveShare } from '@/libs/share-server';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// POST /api/share/[token]/import — recipient-side library import. Auth required.
//
// Strategy: R2 server-side byte-copy.
// The existing `files` table consumers (stats / purge / delete / download)
// all assume `file_key` starts with the row's `user_id`. A reference-based
// import would silently break those invariants, so we copy the bytes into
// the recipient's namespace instead. R2 server-side copy is one API call
// and incurs no egress.
//
// Idempotent: if the recipient already has a non-deleted `files` row for the
// same `book_hash`, we return their existing fileId with `alreadyOwned: true`
// and skip the copy. Saves egress on repeated imports.
export async function POST(request: Request, { params }: RouteParams) {
  const { token: shareToken } = await params;

  const { user, token: jwt } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !jwt) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const result = await resolveActiveShare(shareToken);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;

  // Self-imports are no-ops; redirect the user to their own copy without
  // burning a copy operation.
  if (share.userId === user.id) {
    const supabase = createSupabaseAdminClient();
    const { data: own } = await supabase
      .from('files')
      .select('id, book_hash')
      .eq('user_id', user.id)
      .eq('book_hash', share.bookHash)
      .is('deleted_at', null)
      .not('file_key', 'ilike', '%.png')
      .not('file_key', 'ilike', '%.jpg')
      .not('file_key', 'ilike', '%.jpeg')
      .not('file_key', 'ilike', '%.webp')
      .not('file_key', 'ilike', '%.gif')
      .limit(1)
      .maybeSingle();
    if (own) {
      return NextResponse.json({
        fileId: own.id,
        alreadyOwned: true,
        bookHash: share.bookHash,
        cfi: share.cfi,
      });
    }
  }

  const supabase = createSupabaseAdminClient();

  // Idempotency: look up existing rows for the same (user_id, book_hash),
  // INCLUDING soft-deleted ones. file_key is unique globally, so an active
  // import that the user later deleted leaves a row that would collide with
  // a fresh insert below — we restore it instead of failing.
  const { data: existing, error: existingError } = await supabase
    .from('files')
    .select('id, file_key, deleted_at')
    .eq('user_id', user.id)
    .eq('book_hash', share.bookHash);
  if (existingError) {
    console.error('Share import existing-row lookup failed:', existingError);
    return NextResponse.json({ error: 'Could not check library' }, { status: 500 });
  }
  const existingRows = (existing ?? []).filter((f) => !/\.(png|jpe?g|webp|gif)$/i.test(f.file_key));
  const liveRow = existingRows.find((f) => f.deleted_at === null);
  if (liveRow) {
    return NextResponse.json({
      fileId: liveRow.id,
      alreadyOwned: true,
      bookHash: share.bookHash,
      cfi: share.cfi,
    });
  }
  const deletedRow = existingRows.find((f) => f.deleted_at !== null);
  if (deletedRow) {
    // Restore the soft-deleted row so the unique file_key constraint isn't
    // hit by a fresh insert. The bytes may also still be in storage; if the
    // copy below succeeds it overwrites them, if it doesn't we leave the
    // row in its restored state so the user can re-attempt later.
    const { error: restoreError } = await supabase
      .from('files')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', deletedRow.id);
    if (restoreError) {
      console.error('Share import restore-deleted-row failed:', restoreError);
      return NextResponse.json({ error: 'Could not restore book' }, { status: 500 });
    }
    return NextResponse.json({
      fileId: deletedRow.id,
      alreadyOwned: true,
      bookHash: share.bookHash,
      cfi: share.cfi,
    });
  }

  // Quota check before doing any byte-copy work. JWT-based but consistent
  // with how the existing upload endpoint enforces it.
  const { usage, quota } = getStoragePlanData(jwt);
  if (usage + share.bookSize > quota + STORAGE_QUOTA_GRACE_BYTES) {
    return NextResponse.json(
      { error: 'Insufficient storage quota', code: 'quota_exceeded', usage, quota },
      { status: 402 },
    );
  }

  // Translate the sharer's file_keys into the recipient's namespace by
  // swapping the leading user-id prefix. Existing convention: file_key looks
  // like `${userId}/Readest/Book/{hash}/{filename}`.
  const sharerPrefix = `${share.userId}/`;
  const recipientPrefix = `${user.id}/`;

  const remap = (sourceKey: string): string | null => {
    if (!sourceKey.startsWith(sharerPrefix)) return null;
    return recipientPrefix + sourceKey.slice(sharerPrefix.length);
  };

  const destBookKey = remap(share.bookFileKey);
  if (!destBookKey) {
    console.error('Share import: source key does not start with sharer user id', share.bookFileKey);
    return NextResponse.json({ error: 'Cannot remap shared file' }, { status: 500 });
  }

  // Verify source bytes still exist before allocating a destination row.
  const sourceExists = await objectExists(share.bookFileKey);
  if (!sourceExists) {
    return NextResponse.json(
      { error: 'Shared book is no longer available', code: 'source_deleted' },
      { status: 410 },
    );
  }

  // Insert destination row first (to grab a stable id), then copy bytes,
  // then mark the row clean. On copy failure we soft-delete the row so the
  // user's library doesn't show a phantom book.
  const { data: insertedBook, error: insertBookError } = await supabase
    .from('files')
    .insert({
      user_id: user.id,
      book_hash: share.bookHash,
      file_key: destBookKey,
      file_size: share.bookSize,
    })
    .select('id')
    .single();
  if (insertBookError || !insertedBook) {
    console.error('Share import insert book row failed:', insertBookError);
    return NextResponse.json({ error: 'Could not import book' }, { status: 500 });
  }

  try {
    const copyResp = await copyObject(share.bookFileKey, destBookKey);
    // R2 (aws4fetch) returns a Response; S3 SDK returns a structured object.
    // Both throw on hard failures; treat any non-ok HTTP response as a fail.
    if (copyResp && typeof (copyResp as Response).ok === 'boolean' && !(copyResp as Response).ok) {
      throw new Error(`R2 copy failed: ${(copyResp as Response).status}`);
    }
  } catch (err) {
    console.error('Share import book copy failed:', err);
    // Soft-delete the orphaned row so it doesn't count against quota or appear
    // in the library list.
    await supabase
      .from('files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', insertedBook.id);
    return NextResponse.json({ error: 'Could not import book' }, { status: 500 });
  }

  // Cover is best-effort. A failure here doesn't fail the import — the
  // recipient still gets the book; the cover will simply be missing in
  // their library until they refresh from elsewhere.
  if (share.coverFileKey) {
    const destCoverKey = remap(share.coverFileKey);
    if (destCoverKey) {
      try {
        const coverExists = await objectExists(share.coverFileKey);
        if (coverExists) {
          await copyObject(share.coverFileKey, destCoverKey);
          await supabase.from('files').insert({
            user_id: user.id,
            book_hash: share.bookHash,
            file_key: destCoverKey,
            file_size: 0, // unknown; not material — covers don't bill
          });
        }
      } catch (err) {
        console.error('Share import cover copy failed (non-fatal):', err);
      }
    }
  }

  return NextResponse.json({
    fileId: insertedBook.id,
    alreadyOwned: false,
    bookHash: share.bookHash,
    cfi: share.cfi,
  });
}
