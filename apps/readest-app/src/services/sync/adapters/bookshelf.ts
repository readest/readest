import type { ReplicaAdapter } from '../replicaRegistry';
import type { ReplicaRow } from '@/types/replica';
import { bookshelfSchema } from '@/services/bookshelves/definitions';

/** The definition is one atomic field; position has its own logical clock. */
export const bookshelfAdapter: ReplicaAdapter<ReplicaRow> = {
  kind: 'bookshelf',
  schemaVersion: 1,
  computeId: async (row) => row.replica_id,
  pack: (row) =>
    Object.fromEntries(Object.entries(row.fields_jsonb).map(([key, field]) => [key, field.v])),
  unpack: () => {
    throw new Error('Bookshelves require stamped rows');
  },
  unpackRow: (row) => {
    const definition = row.fields_jsonb['definition']?.v;
    return definition === undefined || bookshelfSchema.safeParse(definition).success ? row : null;
  },
};
