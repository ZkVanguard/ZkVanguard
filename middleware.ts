import { NextRequest, NextResponse } from 'next/server';

// Multi-origin CORS for the rebrand transition. Both old and new domains
// accepted; drop zkvanguard.xyz entries once the domain is fully retired
// (planned ≥12 months after zkward.com cutover so external Suiscan proofs,
// grant reports, and Discord alert links keep resolving).
const ALLOWED_ORIGINS = new Set([
  'https://zkward.com',
  'https://www.zkward.com',
  'https://zkvanguard.xyz',
  'https://www.zkvanguard.xyz',
]);

const ALLOW_HEADERS = 'Content-Type, Authorization, X-Wallet-Address, X-Wallet-Signature, X-Wallet-Message';
const ALLOW_METHODS = 'GET, POST, OPTIONS';

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;

  if (req.method === 'OPTIONS') {
    const preflightHeaders = new Headers();
    if (allow) {
      preflightHeaders.set('Access-Control-Allow-Origin', allow);
      preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
    }
    preflightHeaders.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    preflightHeaders.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    preflightHeaders.set('Vary', 'Origin');
    return new NextResponse(null, { status: 204, headers: preflightHeaders });
  }

  const res = NextResponse.next();
  if (allow) {
    res.headers.set('Access-Control-Allow-Origin', allow);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Vary', 'Origin');
  }
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
