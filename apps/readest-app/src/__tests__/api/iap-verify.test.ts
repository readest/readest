import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/apple/iap-verify/route';
import { NextRequest } from 'next/server';
import { setupSupabaseMocks } from '../helpers/supabase-mock';

const SKIP_IAP_API_TESTS = !process.env['ENABLE_IAP_API_TESTS'];
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      refreshSession: vi.fn(),
    },
    from: vi.fn(),
  },
  createSupabaseAdminClient: vi.fn(),
}));

describe.skipIf(SKIP_IAP_API_TESTS)('/api/apple/iap-verify', () => {
  it('should verify a valid transaction', async () => {
    setupSupabaseMocks();
    const request = new NextRequest('http://localhost:3000/api/apple/iap-verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        transactionId: '2000000969168810',
        originalTransactionId: '2000000968585424',
      }),
    });

    const response = await POST(request);
    const data = await response.json();
    console.log('Response:', data);

    expect(response.status).toBe(200);
    expect(data.purchase).toBeDefined();
  });
});
