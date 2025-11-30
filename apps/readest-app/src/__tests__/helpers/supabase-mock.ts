import { vi } from 'vitest';

export const setupSupabaseMocks = async (
  customResponses = {
    getUser: null,
    select: null,
    upsert: null,
    update: null,
    insert: null,
    adminUpsert: null,
    adminSelect: null,
    adminSelectMany: null,
    adminUpdate: null,
    adminInsert: null,
    adminDelete: null,
    adminSelectSingle: null,
  },
) => {
  const { supabase, createSupabaseAdminClient } = await import('@/utils/supabase');

  vi.mocked(supabase.auth.getUser).mockResolvedValue(
    customResponses.getUser || {
      data: {
        user: {
          id: 'test-user-123',
          email: 'test@example.com',
          app_metadata: {},
          user_metadata: {},
          aud: 'test-aud',
          created_at: new Date().toISOString(),
        },
      },
      error: null,
    },
  );

  vi.mocked(supabase.from).mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(customResponses.select || { data: null, error: null }),
      })),
    })),
    upsert: vi.fn().mockResolvedValue(customResponses.upsert || { data: {}, error: null }),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue(customResponses.update || { data: {}, error: null }),
    })),
    insert: vi.fn().mockResolvedValue(customResponses.insert || { data: {}, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          single: vi
            .fn()
            .mockResolvedValue(customResponses.adminSelect || { data: null, error: null }),
          limit: vi.fn(() => ({
            single: vi
              .fn()
              .mockResolvedValue(customResponses.adminSelect || { data: null, error: null }),
          })),
          order: vi
            .fn()
            .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
        })),
        neq: vi.fn(() => ({
          order: vi
            .fn()
            .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
        })),
        gt: vi.fn(() => ({
          order: vi
            .fn()
            .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
        })),
        in: vi.fn(() => ({
          order: vi
            .fn()
            .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
        })),
        order: vi
          .fn()
          .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
        limit: vi
          .fn()
          .mockResolvedValue(customResponses.adminSelectMany || { data: [], error: null }),
      })),
      upsert: vi.fn().mockResolvedValue(customResponses.adminUpsert || { data: [], error: null }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue(customResponses.adminUpdate || { data: {}, error: null }),
        match: vi.fn().mockResolvedValue(customResponses.adminUpdate || { data: {}, error: null }),
      })),
      insert: vi.fn().mockResolvedValue(customResponses.adminInsert || { data: {}, error: null }),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue(customResponses.adminDelete || { data: {}, error: null }),
        match: vi.fn().mockResolvedValue(customResponses.adminDelete || { data: {}, error: null }),
      })),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
};
