/**
 * RPC URL helper that returns a same-origin proxy URL in the browser
 * to avoid CORS issues with third-party RPC providers (e.g., drpc.org).
 *
 * - Browser: `/api/rpc/{chain}` (same-origin, no CORS)
 * - Server:  direct upstream URL (server-to-server, no CORS)
 */

const UPSTREAM_RPC_URLS: Record<string, string> = {
  sepolia: 'https://sepolia.drpc.org',
  ethereum: 'https://eth.drpc.org',
  hedera: 'https://mainnet.hashio.io/api',
  plasma: 'https://plasma.drpc.org',
};

export function getRpcUrl(chain: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/rpc/${chain}`;
  }
  return UPSTREAM_RPC_URLS[chain] || UPSTREAM_RPC_URLS.sepolia;
}
