import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Combined Middleware: i18n + Geo-Blocking
 * 
 * Optimized for multi-user throughput:
 * - Set-based O(1) lookups instead of Array.some() for path matching
 * - Pre-compiled blocked country set
 * - Minimal work on hot path (public/API routes skip early)
 */

// Create i18n middleware handler once (module-level singleton)
const intlMiddleware = createIntlMiddleware(routing);

// O(1) lookup for blocked countries
const BLOCKED_COUNTRIES = new Set([
  'KP', // North Korea
  'IR', // Iran
  'SY', // Syria
  'CU', // Cuba
  'RU', // Russia (due to 2022 sanctions)
  'BY', // Belarus
]);

// Paths that require geo-blocking (sensitive operations)
// Use prefix array for startsWith matching (still fast at this size)
const PROTECTED_PREFIXES = [
  '/api/swap',
  '/api/hedge',
  '/api/portfolio',
  '/api/agents/hedging/execute',
  '/api/agents/command',
  '/api/zk-proof/generate',
  '/api/settlement',
  '/dashboard',
  '/swap',
];

// Fast prefix set for public paths
const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/prices',
  '/api/chat',
  '/api/agents/status',
  '/api/zk-proof/health',
  '/_next',
  '/favicon.ico',
  '/terms',
  '/privacy',
];

function isProtected(pathname: string): boolean {
  for (let i = 0; i < PROTECTED_PREFIXES.length; i++) {
    if (pathname.startsWith(PROTECTED_PREFIXES[i])) return true;
  }
  return false;
}

function isPublic(pathname: string): boolean {
  for (let i = 0; i < PUBLIC_PREFIXES.length; i++) {
    if (pathname.startsWith(PUBLIC_PREFIXES[i])) return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // FAST PATH: Skip i18n middleware entirely for API routes
  if (pathname.startsWith('/api')) {
    if (isProtected(pathname)) {
      const country = getCountryFromRequest(request);
      if (country && BLOCKED_COUNTRIES.has(country)) {
        logGeoBlock(request, country, pathname);
        return createBlockedResponse(country, pathname);
      }
    }
    return NextResponse.next();
  }
  
  // Apply i18n for non-API routes
  const intlResponse = intlMiddleware(request);
  
  // Skip geo-blocking for public paths
  if (isPublic(pathname)) {
    return intlResponse;
  }
  
  // Check if path requires protection (strip locale from pathname)
  const pathnameWithoutLocale = pathname.replace(/^\/[a-z]{2}(\/|$)/, '/');
  if (!isProtected(pathnameWithoutLocale)) {
    return intlResponse;
  }
  
  // Get country from various geo headers
  const country = getCountryFromRequest(request);
  
  // Development override for testing
  if (process.env.NODE_ENV === 'development' && process.env.GEO_OVERRIDE) {
    const testCountry = process.env.GEO_OVERRIDE;
    if (BLOCKED_COUNTRIES.has(testCountry)) {
      return createBlockedResponse(testCountry, pathname);
    }
    return intlResponse;
  }
  
  // Check if country is blocked
  if (country && BLOCKED_COUNTRIES.has(country)) {
    // Log for compliance (async, don't await)
    logGeoBlock(request, country, pathname);
    return createBlockedResponse(country, pathname);
  }
  
  // Add geo info to headers for downstream use and return intl response
  if (country && intlResponse) {
    intlResponse.headers.set('x-user-country', country);
  }
  
  return intlResponse;
}

/**
 * Extract country code from request headers
 * Supports multiple CDN providers
 */
function getCountryFromRequest(request: NextRequest): string | null {
  // Vercel Edge Network
  if (request.geo?.country) {
    return request.geo.country;
  }
  
  // Vercel header fallback
  const vercelCountry = request.headers.get('x-vercel-ip-country');
  if (vercelCountry) {
    return vercelCountry;
  }
  
  // Cloudflare
  const cfCountry = request.headers.get('cf-ipcountry');
  if (cfCountry) {
    return cfCountry;
  }
  
  // AWS CloudFront
  const awsCountry = request.headers.get('cloudfront-viewer-country');
  if (awsCountry) {
    return awsCountry;
  }
  
  return null;
}

/**
 * Create standardized blocked response
 * Uses HTTP 451 (Unavailable For Legal Reasons)
 */
function createBlockedResponse(country: string, pathname: string): NextResponse {
  const isApiRoute = pathname.startsWith('/api');
  
  if (isApiRoute) {
    // JSON response for API routes
    return new NextResponse(
      JSON.stringify({
        error: 'Service unavailable in your region',
        code: 'GEO_RESTRICTED',
        message: 'This service is not available in your jurisdiction due to regulatory requirements.',
        support: 'For questions, contact compliance@zkvanguard.io'
      }),
      {
        status: 451,
        headers: {
          'Content-Type': 'application/json',
          'X-Blocked-Reason': 'geo-restriction',
          'X-Blocked-Country': country,
        }
      }
    );
  }
  
  // HTML response for page routes
  return new NextResponse(
    `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Service Unavailable - ZK Vanguard</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 500px;
          text-align: center;
          background: rgba(255,255,255,0.05);
          padding: 40px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        h1 { color: #ef4444; margin-bottom: 16px; }
        p { color: #9ca3af; line-height: 1.6; }
        a { color: #3b82f6; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .code { 
          font-family: monospace; 
          background: rgba(0,0,0,0.3);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚫 Service Unavailable</h1>
        <p>
          We're sorry, but ZK Vanguard is not available in your region 
          due to regulatory requirements.
        </p>
        <p>
          If you believe this is an error, please contact us at 
          <a href="mailto:compliance@zkvanguard.io">compliance@zkvanguard.io</a>
        </p>
        <p class="code">Error Code: GEO_RESTRICTED</p>
      </div>
    </body>
    </html>
    `,
    {
      status: 451,
      headers: {
        'Content-Type': 'text/html',
        'X-Blocked-Reason': 'geo-restriction',
      }
    }
  );
}

/**
 * Log geo-blocks for compliance auditing
 * Non-blocking async operation
 */
async function logGeoBlock(
  request: NextRequest, 
  country: string, 
  pathname: string
): Promise<void> {
  try {
    // Hash IP for privacy compliance
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const hashedIP = await hashString(ip);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      hashedIP,
      country,
      pathname,
      userAgent: request.headers.get('user-agent') || 'unknown',
    };
    
    // In production, send to compliance logging service
    if (process.env.NODE_ENV === 'production') {
      // Could send to:
      // - Analytics database
      // - Compliance audit log
      // - SIEM system
      logger.info('[GEO-BLOCK]', { component: 'middleware', data: logEntry });
    }
  } catch (error) {
    // Don't let logging errors affect the request
    logger.error('[GEO-BLOCK LOG ERROR]', error, { component: 'middleware' });
  }
}

/**
 * Hash string for privacy-preserving logging
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    // Match all paths except static files and images
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
