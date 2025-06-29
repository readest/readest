import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [
  'https://web.readest.com',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'tauri://localhost',
  'http://localhost:3000',
  'http://localhost:3001',
];

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '';
  const isAllowedOrigin = allowedOrigins.includes(origin);

  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers({
      ...corsOptions,
      ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
    });

    return new NextResponse(null, {
      status: 200,
      headers: preflightHeaders,
    });
  }

  const response = NextResponse.next();

  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  Object.entries(corsOptions).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: ['/api/stripe/:path*'],
};
