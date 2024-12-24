import { NextRequest, NextResponse } from 'next/server';
import { PostgrestError } from '@supabase/supabase-js';
import { supabase, createSupabaseClient } from '@/utils/supabase';
import { BookDataRecord } from '@/types/book';
import { transformBookConfigToDB } from '@/utils/transform';
import { transformBookNoteToDB } from '@/utils/transform';
import { transformBookToDB } from '@/utils/transform';
import { SyncData, SyncResult, SyncType } from '@/libs/sync';

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

const getUserAndToken = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};

export async function GET(req: NextRequest) {
  const { user, token } = await getUserAndToken(req);
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const supabase = createSupabaseClient(token);

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const typeParam = searchParams.get('type') as SyncType | undefined;
  const bookParam = searchParams.get('book');

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

    const queryTables = async (table: TableName) => {
      let query = supabase.from(table).select('*').eq('user_id', user.id);
      if (bookParam) {
        query.eq('book_hash', bookParam);
      }
      query = query.or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
      console.log('Querying table:', table, 'since:', sinceIso);
      const { data, error } = await query;
      if (error) throw { table, error } as DBError;
      results[DBSyncTypeMap[table] as SyncType] = data || [];
    };

    if (!typeParam || typeParam === 'books') {
      await queryTables('books').catch((err) => (errors['books'] = err));
    }
    if (!typeParam || typeParam === 'configs') {
      await queryTables('book_configs').catch((err) => (errors['book_configs'] = err));
    }
    if (!typeParam || typeParam === 'notes') {
      await queryTables('book_notes').catch((err) => (errors['book_notes'] = err));
    }

    const dbErrors = Object.values(errors).filter((err) => err !== null);
    if (dbErrors.length > 0) {
      console.error('Errors occurred:', dbErrors);
      const errorMsg = dbErrors
        .map((err) => `${err.table}: ${err.error.message || 'Unknown error'}`)
        .join('; ');
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, token } = await getUserAndToken(req);
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const supabase = createSupabaseClient(token);

  const body = await req.json();
  const { books = [], configs = [], notes = [] } = body as SyncData;

  const upsertRecords = async (
    table: TableName,
    primaryKeys: (keyof BookDataRecord)[],
    records: BookDataRecord[],
  ) => {
    const authoritativeRecords: BookDataRecord[] = [];

    for (const rec of records) {
      const dbRec = transformsToDB[table](rec, user.id);
      rec.user_id = user.id;
      rec.book_hash = dbRec.book_hash;
      const matchConditions: Record<string, string | number> = { user_id: user.id };
      for (const pk of primaryKeys) {
        matchConditions[pk] = rec[pk]!;
      }

      const { data: serverData, error: fetchError } = await supabase
        .from(table)
        .select()
        .match(matchConditions)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        return { error: fetchError.message };
      }

      if (!serverData) {
        const { data: inserted, error: insertError } = await supabase
          .from(table)
          .insert(dbRec)
          .select()
          .single();
        if (insertError) return { error: insertError.message };
        authoritativeRecords.push(inserted);
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
          const { data: updated, error: updateError } = await supabase
            .from(table)
            .update(dbRec)
            .match(matchConditions)
            .select()
            .single();
          console.log('Updating record:', updated);
          if (updateError) return { error: updateError.message };
          authoritativeRecords.push(updated);
        } else {
          authoritativeRecords.push(serverData);
        }
      }
    }

    return { data: authoritativeRecords };
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
