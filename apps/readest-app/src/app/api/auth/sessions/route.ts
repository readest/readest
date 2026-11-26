import { NextResponse } from 'next/server';
import { jwtDecode } from 'jwt-decode';
import { getDeviceLimit, validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  groupSessionsByDevice,
  isDeviceLimitReached,
  type AuthSessionRow,
  type SyncDevicesResponse,
} from '@/utils/syncDevices';

const readSessions = async (request: Request, userId: string, token: string) => {
  const { data, error } = await createSupabaseAdminClient().rpc('list_user_sessions', {
    p_user_id: userId,
  });
  if (error) throw error;
  const sessionId = jwtDecode<{ session_id?: string }>(token).session_id ?? null;
  // Until its first refresh, this session holds the agent of whatever made
  // it: the browser that finished an app's OAuth sign-in, or the server for a
  // QR code sign-in. The request comes from the device itself.
  const userAgent = request.headers.get('user-agent');
  const rows = (data as AuthSessionRow[]).map((row) =>
    row.id === sessionId && userAgent ? { ...row, user_agent: userAgent } : row,
  );
  return { rows, sessionId };
};

const respond = (rows: AuthSessionRow[], sessionId: string | null, token: string) => {
  const groups = groupSessionsByDevice(rows, sessionId);
  const limit = getDeviceLimit(token);
  const response: SyncDevicesResponse = {
    devices: groups.map(({ sessionIds: _ids, firstSeenAt: _first, ...device }) => device),
    limit,
    blocked: isDeviceLimitReached(groups, limit),
  };
  return { groups, response };
};

// GET /api/auth/sessions: the devices signed in to the account, and whether
// this one is over the plan's device limit.
export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  try {
    const { rows, sessionId } = await readSessions(request, user.id, token);
    return NextResponse.json(respond(rows, sessionId, token).response);
  } catch (error) {
    console.error('Failed to list sessions:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

// DELETE /api/auth/sessions {id}: signs another device out, every session it
// holds. This device signs out through Sign Out instead.
export async function DELETE(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'Missing device' }, { status: 400 });
  }
  try {
    const { rows, sessionId } = await readSessions(request, user.id, token);
    const device = respond(rows, sessionId, token).groups.find(
      (group) => group.id === body.id && !group.current,
    );
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    const { error } = await createSupabaseAdminClient().rpc('delete_user_sessions', {
      p_user_id: user.id,
      p_session_ids: device.sessionIds,
    });
    if (error) throw error;
    // The devices left, from the same read: reading again could fail after
    // the sign-out has already happened.
    const left = rows.filter((row) => !device.sessionIds.includes(row.id));
    return NextResponse.json(respond(left, sessionId, token).response);
  } catch (error) {
    console.error('Failed to sign out a device:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
