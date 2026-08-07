import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lng = searchParams.get('lng');
  const ns = searchParams.get('ns');

  if (!lng || !ns) {
    return new NextResponse('Missing lng or ns', { status: 400 });
  }

  try {
    const filePath = path.join(process.cwd(), 'public', 'locales', lng, `${ns}.json`);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (_error) {
    return new NextResponse('Locales file not found', { status: 404 });
  }
}
