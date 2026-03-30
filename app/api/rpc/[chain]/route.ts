import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 15;

/**
 * Server-side RPC proxy to avoid CORS issues with third-party RPC providers.
 * Browser requests go to /api/rpc/{chain}, and the server forwards them upstream.
 * Includes multiple fallback providers and timeouts for reliability.
 */

const UPSTREAM_RPC_URLS: Record<string, string[]> = {
  sepolia: [
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.drpc.org',
    'https://rpc2.sepolia.org',
  ],
  ethereum: [
    'https://eth.drpc.org',
    'https://ethereum-rpc.publicnode.com',
    'https://rpc.ankr.com/eth',
  ],
  hedera: [
    'https://testnet.hashio.io/api',
    'https://mainnet.hashio.io/api',
  ],
  plasma: [
    'https://plasma.drpc.org',
  ],
};

// Allowed chains to prevent SSRF via arbitrary chain names
const ALLOWED_CHAINS = new Set(Object.keys(UPSTREAM_RPC_URLS));

const RPC_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, body: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chain: string }> }
) {
  const { chain } = await params;

  if (!ALLOWED_CHAINS.has(chain)) {
    return NextResponse.json({ error: 'Unknown chain' }, { status: 404 });
  }

  const upstreams = UPSTREAM_RPC_URLS[chain];
  const body = await request.text();

  for (const upstream of upstreams) {
    try {
      const response = await fetchWithTimeout(upstream, body, RPC_TIMEOUT_MS);

      if (!response.ok) continue;

      const data = await response.text();
      return new NextResponse(data, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Timeout or network error — try next provider
      continue;
    }
  }

  return NextResponse.json(
    { error: 'All RPC providers failed' },
    { status: 502 }
  );
}
