import { NextResponse, type NextRequest } from 'next/server';

/** www.magura.app → magura.app, so links and share cards always use one address. */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  if (host.startsWith('www.')) {
    const url = req.nextUrl.clone();
    url.host = host.slice(4);
    url.port = '';
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
