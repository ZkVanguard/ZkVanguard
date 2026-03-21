import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side RPC proxy to avoid CORS issues with third-party RPC providers.
 * Browser requests go to /api/rpc/{chain}, and the server forwards them upstream.
 */

const UPSTREAM_RPC_URLS: Record<string, string> = {
  sepolia: 'https://sepolia.drpc.org',
  ethereum: 'https://eth.drpc.org',
  arbitrum: 'https://arbitrum.drpc.org',
  plasma: 'https://plasma.drpc.org',
};

// Allowed chains to prevent SSRF via arbitrary chain names
const ALLOWED_CHAINS = new Set(Object.keys(UPSTREAM_RPC_URLS));

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chain: string }> }
) {
  const { chain } = await params;

  if (!ALLOWED_CHAINS.has(chain)) {
    return NextResponse.json({ error: 'Unknown chain' }, { status: 404 });
  }

  const upstream = UPSTREAM_RPC_URLS[chain];
  const body = await request.text();

  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'RPC request failed' },
      { status: 502 }
    );
  }
}
