/**
 * The devices signed in to an account, from its Supabase sessions. A session
 * row only holds the user agent of whatever last refreshed it, so devices are
 * told apart by the kind of device that agent names (Chrome on macOS, Readest
 * on Pixel 7), whatever its version. A device that signed in again without
 * signing out holds several sessions and still counts once.
 */

/** A row of `list_user_sessions` (migration 035). */
export interface AuthSessionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
}

export interface SyncDevice {
  id: string;
  /** Readest, Chrome, KOReader, ..., or null when the agent says nothing. */
  client: string | null;
  /** macOS, iPhone, a model such as Pixel 7, ..., or null. */
  os: string | null;
  lastActiveAt: string;
  current: boolean;
}

export interface SyncDeviceGroup extends SyncDevice {
  sessionIds: string[];
  firstSeenAt: string;
}

export interface SyncDevicesResponse {
  devices: SyncDevice[];
  /** How many devices the plan syncs on, or null for no limit. */
  limit: number | null;
  /** This device may not sign in until another one signs out. */
  blocked: boolean;
}

const OS_NAMES: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

const BROWSER_NAMES: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

// Chrome's reduced agent names every Android device "K".
const ANDROID_MODEL = /Android [^;)]*; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/;

export const describeUserAgent = (
  ua: string | null | undefined,
): { client: string; os: string } | null => {
  if (!ua) return null;
  // KOReader/v2025.08 (Kindle Paperwhite 5; Linux; arm) LuaSocket/3.0.0
  const koreader = ua.match(/^KOReader\/\S+ \(([^;)]+)/);
  if (koreader) return { client: 'KOReader', os: koreader[1]!.trim() };
  if (!ua.startsWith('Mozilla/')) return null;

  const os = OS_NAMES.find(([pattern]) => pattern.test(ua))?.[1];
  if (!os) return null;
  // The apps run in the system web view: Android's says "wv", and Apple's
  // WKWebView leaves out Safari's token.
  const isApp =
    /; wv\)/.test(ua) ||
    (['iPhone', 'iPad', 'macOS'].includes(os) &&
      /AppleWebKit\//.test(ua) &&
      !/Safari\/|CriOS\/|FxiOS\/|EdgiOS\//.test(ua));
  const client = isApp ? 'Readest' : BROWSER_NAMES.find(([pattern]) => pattern.test(ua))?.[1];
  if (!client) return null;

  const model = os === 'Android' ? ua.match(ANDROID_MODEL)?.[1] : undefined;
  return { client, os: model && model !== 'K' && model !== 'wv' ? model : os };
};

const time = (timestamp: string) => Date.parse(timestamp);

/** Groups sessions by device: this device first, then the most recently active. */
export const groupSessionsByDevice = (
  rows: AuthSessionRow[],
  currentSessionId: string | null,
): SyncDeviceGroup[] => {
  const groups = new Map<string, SyncDeviceGroup>();
  for (const row of rows) {
    const agent = describeUserAgent(row.user_agent);
    // An agent that names nothing can't be matched with anything else.
    const id = agent ? `${agent.client}|${agent.os}` : row.id;
    const current = row.id === currentSessionId;
    const group = groups.get(id);
    if (!group) {
      groups.set(id, {
        id,
        client: agent?.client ?? null,
        os: agent?.os ?? null,
        lastActiveAt: row.last_active_at,
        firstSeenAt: row.created_at,
        current,
        sessionIds: [row.id],
      });
      continue;
    }
    group.sessionIds.push(row.id);
    group.current ||= current;
    if (time(row.last_active_at) > time(group.lastActiveAt))
      group.lastActiveAt = row.last_active_at;
    if (time(row.created_at) < time(group.firstSeenAt)) group.firstSeenAt = row.created_at;
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || time(b.lastActiveAt) - time(a.lastActiveAt),
  );
};

/**
 * Whether this device is one too many. Only devices signed in before it
 * count, so a new sign-in sees every other device, and the devices that were
 * signed in first are never sent away by later ones, even when they sign in
 * again.
 */
export const isDeviceLimitReached = (devices: SyncDeviceGroup[], limit: number | null): boolean => {
  if (limit === null) return false;
  const signedInAt = devices.find((device) => device.current)?.firstSeenAt;
  const earlier = devices.filter(
    (device) => !device.current && (!signedInAt || time(device.firstSeenAt) < time(signedInAt)),
  );
  return earlier.length >= limit;
};
