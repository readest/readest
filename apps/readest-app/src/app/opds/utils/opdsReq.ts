import { md5 } from 'js-md5';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * Extract username and password from URL credentials
 */
const extractCredentialsFromURL = (
  url: string,
): { url: string; username?: string; password?: string } => {
  try {
    const urlObj = new URL(url);
    const username = decodeURIComponent(urlObj.username) || undefined;
    const password = decodeURIComponent(urlObj.password) || undefined;

    if (username || password) {
      urlObj.username = '';
      urlObj.password = '';
      return {
        url: urlObj.toString(),
        username,
        password,
      };
    }
  } catch (e) {
    console.warn('Failed to parse URL:', e);
  }

  return { url };
};

export const needsProxy = (url: string): boolean => {
  return isWebAppPlatform() && url.startsWith('http');
};

/**
 * Generate proxied URL for OPDS requests
 */
export const getProxiedURL = (url: string, auth: string = '', stream = false): string => {
  if (url.startsWith('http')) {
    const { url: cleanUrl } = extractCredentialsFromURL(url);
    const params = new URLSearchParams();
    params.append('url', cleanUrl);
    params.append('stream', `${stream}`);
    if (auth) {
      params.append('auth', auth);
    }
    const proxyUrl = `/api/opds/proxy?${params.toString()}`;
    return proxyUrl;
  }
  return url;
};

/**
 * Parse Digest authentication challenge from WWW-Authenticate header
 */
const parseDigestChallenge = (challenge: string): Record<string, string> => {
  const params: Record<string, string> = {};
  const regex = /(\w+)=["']?([^"',]+)["']?/g;
  let match;

  while ((match = regex.exec(challenge)) !== null) {
    params[match[1]!] = match[2]!;
  }

  return params;
};

/**
 * Generate Digest authentication response hash
 */
const generateDigestResponse = (
  username: string,
  password: string,
  params: Record<string, string>,
  method: string,
  uri: string,
  nc: string,
  cnonce: string,
) => {
  const realm = params['realm'];
  const nonce = params['nonce'];
  const qop = params['qop'];
  const algorithm = params['algorithm'];

  let ha1 = md5(`${username}:${realm}:${password}`);

  if (algorithm && algorithm.toLowerCase() === 'md5-sess') {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }

  const ha2 = md5(`${method}:${uri}`);

  let response: string;

  if (qop) {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  return response;
};

/**
 * Create Digest Authorization header
 */
export const createDigestAuth = async (
  username: string,
  password: string,
  wwwAuthenticate: string,
  method: string,
  uri: string,
): Promise<string> => {
  const params = parseDigestChallenge(wwwAuthenticate);
  const cnonce = Math.random().toString(36).slice(2);
  const nc = '00000001';
  const response = await generateDigestResponse(
    username,
    password,
    params,
    method,
    uri,
    nc,
    cnonce,
  );

  const parts = [
    `username="${username}"`,
    `realm="${params['realm']}"`,
    `nonce="${params['nonce']}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (params['algorithm']) {
    parts.push(`algorithm="${params['algorithm']}"`);
  }

  if (params['opaque']) {
    parts.push(`opaque="${params['opaque']}"`);
  }

  if (params['qop']) {
    parts.push(`qop="auth"`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }

  return `Digest ${parts.join(', ')}`;
};

/**
 * Create Basic Authorization header
 */
export const createBasicAuth = (username: string, password: string): string => {
  const credentials = btoa(`${username}:${password}`);
  return `Basic ${credentials}`;
};

/**
 * Probe URL for authentication requirements using HEAD request
 * Returns auth header if authentication is needed, null otherwise
 */
export const probeAuth = async (
  url: string,
  username?: string,
  password?: string,
  useProxy = false,
): Promise<string | null> => {
  const {
    url: cleanUrl,
    username: urlUsername,
    password: urlPassword,
  } = extractCredentialsFromURL(url);

  const finalUsername = username || urlUsername;
  const finalPassword = password || urlPassword;

  // No credentials provided, can't generate auth header
  if (!finalUsername || !finalPassword) {
    return null;
  }

  const fetchURL = useProxy ? getProxiedURL(cleanUrl) : cleanUrl;
  const headers: Record<string, string> = {
    Accept: 'application/atom+xml, application/xml, text/xml',
  };

  // Probe with HEAD request
  const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const res = await fetch(fetchURL, {
    method: 'HEAD',
    headers,
  });

  // Check if authentication is required
  if (res.status === 401 || res.status === 403) {
    const wwwAuthenticate = res.headers.get('WWW-Authenticate');
    if (wwwAuthenticate) {
      if (wwwAuthenticate.toLowerCase().startsWith('digest')) {
        const urlObj = new URL(cleanUrl);
        return await createDigestAuth(
          finalUsername,
          finalPassword,
          wwwAuthenticate,
          'GET',
          urlObj.pathname + urlObj.search,
        );
      } else if (wwwAuthenticate.toLowerCase().startsWith('basic')) {
        return createBasicAuth(finalUsername, finalPassword);
      }
    }
  }

  return null;
};

/**
 * Perform authenticated HTTP request with retry logic for Digest/Basic auth
 */
export const fetchWithAuth = async (
  url: string,
  username?: string,
  password?: string,
  useProxy = false,
  options: RequestInit = {},
): Promise<Response> => {
  const {
    url: cleanUrl,
    username: urlUsername,
    password: urlPassword,
  } = extractCredentialsFromURL(url);

  const finalUsername = username || urlUsername;
  const finalPassword = password || urlPassword;

  const fetchURL = useProxy ? getProxiedURL(cleanUrl) : cleanUrl;
  const headers: Record<string, string> = {
    Accept: 'application/atom+xml, application/xml, text/xml',
    ...(options.headers as Record<string, string>),
  };

  const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  let res = await fetch(fetchURL, {
    ...options,
    method: options.method || 'GET',
    headers,
  });

  // Handle authentication if needed
  if (!res.ok && (res.status === 401 || res.status === 403) && finalUsername && finalPassword) {
    const wwwAuthenticate = res.headers.get('WWW-Authenticate');
    if (wwwAuthenticate) {
      let authHeader: string | null = null;

      if (wwwAuthenticate.toLowerCase().startsWith('digest')) {
        const urlObj = new URL(cleanUrl);
        authHeader = await createDigestAuth(
          finalUsername,
          finalPassword,
          wwwAuthenticate,
          options.method || 'GET',
          urlObj.pathname + urlObj.search,
        );
      } else if (wwwAuthenticate.toLowerCase().startsWith('basic')) {
        authHeader = createBasicAuth(finalUsername, finalPassword);
      }

      if (authHeader) {
        const finalUrl = useProxy ? `${fetchURL}&auth=${encodeURIComponent(authHeader)}` : fetchURL;
        res = await fetch(finalUrl, {
          ...options,
          method: options.method || 'GET',
          headers: useProxy ? headers : { ...headers, Authorization: authHeader },
        });
      }
    }
  }

  return res;
};
