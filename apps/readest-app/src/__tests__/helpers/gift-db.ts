import { GiftCardRow } from '@/types/gift';

// An in-memory stand-in for the Supabase admin client, for the gift card
// tests. Each query runs atomically when it is awaited, so two calls started
// together interleave between queries the way two requests do against
// Postgres. `gift_cards` keeps the migration's unique columns, defaults and
// recipient-email trigger, so a conditional update that would fail in the
// database fails here too.

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null };

export interface DbWrite {
  table: string;
  op: 'insert' | 'update' | 'delete';
  values: Row | null;
  /** The `eq` filters of the write. */
  match: Row;
}

interface TableSpec {
  unique: string[];
  defaults: () => Row;
  /** A before-update trigger: returns an error message to reject the row. */
  guard: (before: Row, after: Row) => string | null;
}

class Query {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private values: Row | null = null;
  private returning = false;
  private filters: Array<(row: Row) => boolean> = [];
  private match: Row = {};
  private sort: { column: string; ascending: boolean } | null = null;
  private window: { from: number; to: number } | null = null;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(
    private db: GiftDb,
    private table: string,
  ) {}

  select(_columns?: string) {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(values: Row) {
    this.op = 'insert';
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.match[column] = value;
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  not(column: string, _op: 'is', value: null) {
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  gt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) > value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) < value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.sort = { column, ascending };
    return this;
  }
  range(from: number, to: number) {
    this.window = { from, to };
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybeSingle';
    return this;
  }

  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  then<T1 = Result, T2 = never>(
    onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected);
  }

  private duplicate(row: Row, others: Row[]): DbError | null {
    for (const column of this.db.spec(this.table).unique) {
      const value = row[column];
      if (value != null && others.some((other) => other[column] === value)) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "${this.table}_${column}_key"`,
        };
      }
    }
    return null;
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    const spec = this.db.spec(this.table);
    const matches = (row: Row) => this.filters.every((filter) => filter(row));
    let out: Row[];

    if (this.op === 'insert') {
      const row = { ...spec.defaults(), ...this.values };
      const duplicate = this.duplicate(row, rows);
      if (duplicate) return { data: null, error: duplicate };
      rows.push(row);
      out = [row];
    } else if (this.op === 'update') {
      out = rows.filter(matches);
      for (const row of out) {
        const next = { ...row, ...this.values };
        const rejected = spec.guard(row, next);
        if (rejected) return { data: null, error: { code: 'P0001', message: rejected } };
        const duplicate = this.duplicate(
          next,
          rows.filter((other) => other !== row),
        );
        if (duplicate) return { data: null, error: duplicate };
      }
      for (const row of out) Object.assign(row, this.values);
      // gift_cards_guard (migration 034) stamps updated_at on every update,
      // a repeat of the same values included.
      if (this.table === 'gift_cards') for (const row of out) row['updated_at'] = this.db.clock();
    } else if (this.op === 'delete') {
      out = rows.filter(matches);
      this.db.tables[this.table] = rows.filter((row) => !out.includes(row));
    } else {
      out = rows.filter(matches);
    }

    if (this.op !== 'select') {
      this.db.writes.push({
        table: this.table,
        op: this.op,
        values: this.values,
        match: this.match,
      });
    }
    if (this.sort) {
      const { column, ascending } = this.sort;
      out = [...out].sort(
        (a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1),
      );
    }
    if (this.op === 'select') {
      // PostgREST answers at most `max-rows` rows, however many match.
      const from = this.window?.from ?? 0;
      const to = this.window ? this.window.to + 1 : out.length;
      out = out.slice(from, Math.min(to, from + this.db.maxRows));
    }

    const copies = out.map((row) => ({ ...row }));
    if (this.mode === 'many') {
      return { data: this.op === 'select' || this.returning ? copies : null, error: null };
    }
    if (copies.length > 1 || (this.mode === 'single' && copies.length === 0)) {
      return { data: null, error: { code: 'PGRST116', message: `${copies.length} rows` } };
    }
    return { data: copies[0] ?? null, error: null };
  }
}

const NO_SPEC: TableSpec = { unique: [], defaults: () => ({}), guard: () => null };

export interface GiftDbUser {
  id: string;
  email: string;
  confirmed: boolean;
}

export class GiftDb {
  tables: Record<string, Row[]> = {};
  writes: DbWrite[] = [];
  /** The recipient ids `claim_gifts_for_confirmed_emails` reports. */
  sweepClaims: string[] = [];
  /** PostgREST's `max-rows`, as Supabase sets it. */
  maxRows = 1000;
  /** The database's now(), for what its triggers stamp. */
  clock = (): string => new Date().toISOString();
  private seq = 0;
  private specs: Record<string, TableSpec>;

  constructor(private users: GiftDbUser[] = []) {
    this.specs = {
      gift_cards: {
        unique: [
          'id',
          'code',
          'stripe_payment_intent_id',
          'apple_original_transaction_id',
          'google_purchase_token',
        ],
        defaults: () => {
          const n = ++this.seq;
          const stamp = new Date(Date.UTC(2026, 10, 1) + n * 1000).toISOString();
          return {
            id: `card-${n}`,
            buyer_id: null,
            days: 365,
            status: 'pending',
            recipient_name: null,
            sender_name: null,
            message: null,
            recipient_email: null,
            provider: null,
            test: false,
            stripe_payment_intent_id: null,
            apple_original_transaction_id: null,
            google_purchase_token: null,
            purchased_at: null,
            redeemed_by: null,
            redeemed_at: null,
            created_at: stamp,
            updated_at: stamp,
          };
        },
        // gift_cards_guard in 034_gift_cards.sql.
        guard: (before, after) =>
          after['recipient_email'] !== before['recipient_email'] &&
          (before['recipient_email'] !== null || before['redeemed_at'] !== null)
            ? 'gift card recipient email cannot be changed'
            : null,
      },
    };
  }

  /** The admin client the code under test gets from `createSupabaseAdminClient`. */
  client = {
    from: (table: string) => new Query(this, table),
    rpc: (name: string, args: Record<string, unknown>): Promise<Result> => {
      if (name === 'claim_gifts_for_confirmed_emails') {
        return Promise.resolve({ data: this.sweepClaims, error: null });
      }
      if (name !== 'gift_user_id_for_email') throw new Error(`unexpected rpc: ${name}`);
      const email = String(args['p_email']).trim().toLowerCase();
      const user = this.users.find((u) => u.email === email && u.confirmed);
      return Promise.resolve({ data: user?.id ?? null, error: null });
    },
  };

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  spec(table: string): TableSpec {
    return this.specs[table] ?? NO_SPEC;
  }

  /** Deletes an auth user: `buyer_id` and `redeemed_by` are ON DELETE SET NULL. */
  deleteUser(id: string) {
    this.users = this.users.filter((user) => user.id !== id);
    for (const row of this.rows('gift_cards')) {
      if (row['buyer_id'] === id) row['buyer_id'] = null;
      if (row['redeemed_by'] === id) row['redeemed_by'] = null;
    }
  }

  /** Puts a card straight into the table, outside the code under test. */
  addCard(card: Partial<GiftCardRow>): GiftCardRow {
    const row = { ...this.spec('gift_cards').defaults(), code: `CARD${++this.seq}`, ...card };
    this.rows('gift_cards').push(row);
    return { ...row } as unknown as GiftCardRow;
  }

  get cards(): GiftCardRow[] {
    return this.rows('gift_cards').map((row) => ({ ...row }) as unknown as GiftCardRow);
  }

  card(id: string): GiftCardRow | undefined {
    return this.cards.find((card) => card.id === id);
  }

  /** Every write to `plans`, as `{ id, ...values }`. */
  planWrites(): Row[] {
    return this.writes
      .filter((write) => write.table === 'plans')
      .map((write) => ({ ...write.match, ...write.values }));
  }
}
