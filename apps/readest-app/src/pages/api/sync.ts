import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { PostgrestError } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/utils/supabase';
import { BookDataRecord } from '@/types/book';
import { transformBookConfigToDB } from '@/utils/transform';
import { transformBookNoteToDB } from '@/utils/transform';
import { transformBookToDB } from '@/utils/transform';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import { SyncData, SyncRecord, SyncResult, SyncType } from '@/libs/sync';
import { validateUserAndToken } from '@/utils/access';
import { DBBook, DBBookConfig } from '@/types/records';

const transformsToDB = {
  books: transformBookToDB,
  book_notes: transformBookNoteToDB,
  book_configs: transformBookConfigToDB,
};

const DBSyncTypeMap = {
  books: 'books',
  book_notes: 'notes',
  book_configs: 'configs',
};

type TableName = keyof typeof transformsToDB;

type DBError = { table: TableName; error: PostgrestError };

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const supabase = createSupabaseClient(token);

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const typeParam = searchParams.get('type') as SyncType | undefined;
  const bookParam = searchParams.get('book');
  const metaHashParam = searchParams.get('meta_hash');

  if (!sinceParam) {
    return NextResponse.json({ error: '"since" query parameter is required' }, { status: 400 });
  }

  const since = new Date(Number(sinceParam));
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid "since" timestamp' }, { status: 400 });
  }

  const sinceIso = since.toISOString();

  try {
    const results: SyncResult = { books: [], configs: [], notes: [] };
    const errors: Record<TableName, DBError | null> = {
      books: null,
      book_notes: null,
      book_configs: null,
    };

    const queryTables = async (table: TableName, dedupeKeys?: (keyof BookDataRecord)[]) => {
      const PAGE_SIZE = 1000;
      let allRecords: SyncRecord[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from(table)
          .select('*')
          .eq('user_id', user.id)
          .range(offset, offset + PAGE_SIZE - 1);

        if (bookParam && metaHashParam) {
          query = query.or(`book_hash.eq.${bookParam},meta_hash.eq.${metaHashParam}`);
        } else if (bookParam) {
          query = query.eq('book_hash', bookParam);
        } else if (metaHashParam) {
          query = query.eq('meta_hash', metaHashParam);
        }

        query = query.or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
        query = query.order('updated_at', { ascending: false });

        console.log('Querying table:', table, 'since:', sinceIso, 'offset:', offset);

        const { data, error } = await query;
        if (error) throw { table, error } as DBError;

        if (data && data.length > 0) {
          allRecords = allRecords.concat(data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      let records = allRecords;
      if (dedupeKeys && dedupeKeys.length > 0) {
        const seen = new Set<string>();
        records = records.filter((rec) => {
          const key = dedupeKeys
            .map((k) => rec[k])
            .filter(Boolean)
            .join('|');
          if (key && seen.has(key)) {
            return false;
          } else {
            seen.add(key);
            return true;
          }
        });
      }
      results[DBSyncTypeMap[table] as SyncType] = records || [];
    };

    if (!typeParam || typeParam === 'books') {
      await queryTables('books').catch((err) => (errors['books'] = err));
    }
    if (!typeParam || typeParam === 'configs') {
      await queryTables('book_configs').catch((err) => (errors['book_configs'] = err));
    }
    if (!typeParam || typeParam === 'notes') {
      await queryTables('book_notes', ['id']).catch((err) => (errors['book_notes'] = err));
    }

    const dbErrors = Object.values(errors).filter((err) => err !== null);
    if (dbErrors.length > 0) {
      console.error('Errors occurred:', dbErrors);
      const errorMsg = dbErrors
        .map((err) => `${err.table}: ${err.error.message || 'Unknown error'}`)
        .join('; ');
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const response = NextResponse.json(results, { status: 200 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    response.headers.delete('ETag');
    return response;
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const supabase = createSupabaseClient(token);
  const body = await req.json();
  const { books = [], configs = [], notes = [] } = body as SyncData;

  const BATCH_SIZE = 100;
  const upsertRecords = async (
    table: TableName,
    primaryKeys: (keyof BookDataRecord)[],
    records: BookDataRecord[],
  ) => {
    if (records.length === 0) return { data: [] };

    const allAuthoritativeRecords: BookDataRecord[] = [];

    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      // Transform all records to DB format
      const dbRecords = batch.map((rec) => {
        const dbRec = transformsToDB[table](rec, user.id);
        rec.user_id = user.id;
        rec.book_hash = dbRec.book_hash;
        return { original: rec, db: dbRec };
      });

      // Build match conditions for batch
      const matchConditions = dbRecords.map(({ original }) => {
        const conditions: Record<string, string | number> = { user_id: user.id };
        for (const pk of primaryKeys) {
          conditions[pk] = original[pk]!;
        }
        return conditions;
      });

      // Fetch existing records for this batch
      const orConditions = matchConditions
        .map((cond) => {
          const parts = Object.entries(cond).map(([key, val]) => `${key}.eq.${val}`);
          return `and(${parts.join(',')})`;
        })
        .join(',');

      const { data: serverRecords, error: fetchError } = await supabase
        .from(table)
        .select()
        .or(orConditions);

      if (fetchError) {
        return { error: fetchError.message };
      }

      // Create lookup map
      const serverRecordsMap = new Map<string, BookDataRecord>();
      (serverRecords || []).forEach((record) => {
        const key = primaryKeys.map((pk) => record[pk]).join('|');
        serverRecordsMap.set(key, record);
      });

      // Separate into inserts and updates
      const toInsert: (DBBook | DBBookConfig | DBBookConfig)[] = [];
      const toUpdate: (DBBook | DBBookConfig | DBBookConfig)[] = [];
      const batchAuthoritativeRecords: BookDataRecord[] = [];

      for (const { original, db: dbRec } of dbRecords) {
        const key = primaryKeys.map((pk) => original[pk]).join('|');
        const serverData = serverRecordsMap.get(key);

        if (!serverData) {
          dbRec.updated_at = new Date().toISOString();
          toInsert.push(dbRec);
        } else {
          const clientUpdatedAt = dbRec.updated_at ? new Date(dbRec.updated_at).getTime() : 0;
          const serverUpdatedAt = serverData.updated_at
            ? new Date(serverData.updated_at).getTime()
            : 0;
          const clientDeletedAt = dbRec.deleted_at ? new Date(dbRec.deleted_at).getTime() : 0;
          const serverDeletedAt = serverData.deleted_at
            ? new Date(serverData.deleted_at).getTime()
            : 0;
          const clientIsNewer =
            clientDeletedAt > serverDeletedAt || clientUpdatedAt > serverUpdatedAt;

          if (clientIsNewer) {
            toUpdate.push(dbRec);
          } else {
            batchAuthoritativeRecords.push(serverData);
          }
        }
      }

      // Batch insert
      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from(table)
          .insert(toInsert)
          .select();

        if (insertError) {
          console.log(`Failed to insert ${table} records:`, JSON.stringify(toInsert));
          return { error: insertError.message };
        }
        batchAuthoritativeRecords.push(...(inserted || []));
      }

      // Batch upsert
      if (toUpdate.length > 0) {
        const { data: updated, error: updateError } = await supabase
          .from(table)
          .upsert(toUpdate, {
            onConflict: ['user_id', ...primaryKeys].join(','),
          })
          .select();

        if (updateError) {
          console.log(`Failed to update ${table} records:`, JSON.stringify(toUpdate));
          return { error: updateError.message };
        }
        batchAuthoritativeRecords.push(...(updated || []));
      }

      allAuthoritativeRecords.push(...batchAuthoritativeRecords);
    }

    return { data: allAuthoritativeRecords };
  };

  try {
    const [booksResult, configsResult, notesResult] = await Promise.all([
      upsertRecords('books', ['book_hash'], books as BookDataRecord[]),
      upsertRecords('book_configs', ['book_hash'], configs as BookDataRecord[]),
      upsertRecords('book_notes', ['book_hash', 'id'], notes as BookDataRecord[]),
    ]);

    if (booksResult?.error) throw new Error(booksResult.error);
    if (configsResult?.error) throw new Error(configsResult.error);
    if (notesResult?.error) throw new Error(notesResult.error);

    return NextResponse.json(
      {
        books: booksResult?.data || [],
        configs: configsResult?.data || [],
        notes: notesResult?.data || [],
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!req.url) {
    return res.status(400).json({ error: 'Invalid request URL' });
  }

  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, `${protocol}://${host}`);

  await runMiddleware(req, res, corsAllMethods);

  try {
    let response: Response;

    if (req.method === 'GET') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'GET',
      });
      response = await GET(nextReq);
    } else if (req.method === 'POST') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'POST',
        body: JSON.stringify(req.body), // Ensure the body is a string
      });
      response = await POST(nextReq);
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.send(buffer);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
