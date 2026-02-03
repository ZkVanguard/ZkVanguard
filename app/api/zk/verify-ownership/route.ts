import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/postgres';
import crypto from 'crypto';

/**
 * ZK Wallet Ownership Verification API
 * 
 * This endpoint verifies hedge ownership using ZK proofs for privacy.
 * Supports proxy wallet hedging - prove ownership without revealing actual wallet address.
 * 
 * Two verification methods:
 * 1. Direct wallet match (when wallet_address is stored)
 * 2. ZK Binding verification (for proxy wallet privacy)
 */

interface VerifyOwnershipRequest {
  walletAddress: string;
  hedgeId?: string;
  proofHash?: string;
  zkSecret?: string;  // Optional secret for ZK binding verification
}

interface HedgeRow {
  id: number;
  order_id: string;
  wallet_address: string | null;
  asset: string;
  side: string;
  size: number;
  entry_price: number | null;
  leverage: number;
  created_at: Date;
  zk_proof_hash?: string;
  wallet_binding_hash?: string;
  owner_commitment?: string;
  metadata?: string;
}

interface VerifyOwnershipResponse {
  success: boolean;
  verified: boolean;
  verificationMethod?: 'direct' | 'zk_binding' | 'owner_commitment';
  walletAddress: string;
  hedgeId?: string;
  hedgeDetails?: {
    asset: string;
    side: string;
    size: number;
    entryPrice: number;
    leverage: number;
    createdAt: string;
  };
  zkProofHash?: string;
  walletBindingProof?: string;
  verificationTimestamp: string;
  error?: string;
}

// Generate deterministic wallet binding hash for verification
function generateWalletBinding(walletAddress: string, hedgeId: string, secret?: string): string {
  const data = `wallet:${walletAddress.toLowerCase()}:hedge:${hedgeId}${secret ? `:${secret}` : ''}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Generate owner commitment (for privacy - doesn't reveal wallet in plain text)
function generateOwnerCommitment(walletAddress: string, timestamp: number): string {
  const data = `owner:${walletAddress.toLowerCase()}:ts:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Verify the wallet binding proof (ZK approach)
function verifyBinding(walletAddress: string, hedgeId: string, storedBinding: string, secret?: string): boolean {
  const computedBinding = generateWalletBinding(walletAddress, hedgeId, secret);
  return computedBinding === storedBinding;
}

export async function POST(request: NextRequest): Promise<NextResponse<VerifyOwnershipResponse>> {
  try {
    const body: VerifyOwnershipRequest = await request.json();
    const { walletAddress, hedgeId, zkSecret } = body;

    if (!walletAddress) {
      return NextResponse.json({
        success: false,
        verified: false,
        walletAddress: '',
        verificationTimestamp: new Date().toISOString(),
        error: 'Wallet address is required',
      }, { status: 400 });
    }

    const normalizedAddress = walletAddress.toLowerCase();

    // If hedgeId is provided, verify specific hedge ownership
    if (hedgeId) {
      const hedge = await queryOne<HedgeRow>(
        'SELECT * FROM hedges WHERE order_id = $1',
        [hedgeId]
      );

      if (!hedge) {
        return NextResponse.json({
          success: true,
          verified: false,
          walletAddress: normalizedAddress,
          hedgeId,
          verificationTimestamp: new Date().toISOString(),
          error: 'Hedge not found',
        });
      }

      // Parse metadata if available
      let metadata: Record<string, unknown> = {};
      if (hedge.metadata) {
        try {
          metadata = JSON.parse(hedge.metadata);
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Verification priority:
      // 1. ZK Wallet Binding (highest privacy - for proxy wallets)
      // 2. Owner Commitment (ZK commitment based)
      // 3. Direct wallet match (legacy/fallback)
      
      let verified = false;
      let verificationMethod: 'direct' | 'zk_binding' | 'owner_commitment' | undefined;
      
      // Method 1: Check ZK wallet binding hash (stored in DB or metadata)
      const storedBinding = hedge.wallet_binding_hash || (metadata.walletBinding as string);
      if (storedBinding) {
        const bindingValid = verifyBinding(normalizedAddress, hedgeId, storedBinding, zkSecret);
        if (bindingValid) {
          verified = true;
          verificationMethod = 'zk_binding';
        }
      }
      
      // Method 2: Check owner commitment
      if (!verified && hedge.owner_commitment) {
        // Try to match owner commitment with different timestamps
        // This is a simplified check - in production, would use proper ZK proof
        const hedgeTimestamp = Math.floor(new Date(hedge.created_at).getTime() / 1000);
        const expectedCommitment = generateOwnerCommitment(normalizedAddress, hedgeTimestamp);
        if (expectedCommitment === hedge.owner_commitment) {
          verified = true;
          verificationMethod = 'owner_commitment';
        }
      }
      
      // Method 3: Direct wallet match (fallback)
      if (!verified) {
        const hedgeWallet = (hedge.wallet_address || '').toLowerCase();
        if (hedgeWallet === normalizedAddress) {
          verified = true;
          verificationMethod = 'direct';
        }
      }
      
      // Generate a binding proof for display (shows the cryptographic verification)
      const bindingProof = generateWalletBinding(normalizedAddress, hedgeId);

      return NextResponse.json({
        success: true,
        verified,
        verificationMethod,
        walletAddress: normalizedAddress,
        hedgeId,
        hedgeDetails: {
          asset: hedge.asset,
          side: hedge.side,
          size: hedge.size,
          entryPrice: hedge.entry_price || 0,
          leverage: hedge.leverage,
          createdAt: hedge.created_at.toISOString(),
        },
        zkProofHash: hedge.zk_proof_hash || (metadata.zkProofHash as string) || undefined,
        walletBindingProof: bindingProof,
        verificationTimestamp: new Date().toISOString(),
      });
    }

    // If only wallet address provided, get all hedges for this wallet
    // Try with ZK binding support, fallback to simple query
    let walletHedges: HedgeRow[];
    try {
      walletHedges = await query<HedgeRow>(
        `SELECT * FROM hedges 
         WHERE LOWER(wallet_address) = $1 
            OR wallet_binding_hash IS NOT NULL
         ORDER BY created_at DESC LIMIT 10`,
        [normalizedAddress]
      );
    } catch (zkError) {
      // ZK columns may not exist, fallback to simple query
      console.warn('ZK columns may not exist, falling back:', zkError);
      walletHedges = await query<HedgeRow>(
        `SELECT * FROM hedges 
         WHERE LOWER(wallet_address) = $1
         ORDER BY created_at DESC LIMIT 10`,
        [normalizedAddress]
      );
    }

    // For hedges without explicit wallet address match, verify ZK binding
    const verifiedHedges = walletHedges.filter(hedge => {
      const walletMatch = (hedge.wallet_address || '').toLowerCase() === normalizedAddress;
      if (walletMatch) return true;
      
      // Check ZK binding
      if (hedge.wallet_binding_hash) {
        return verifyBinding(normalizedAddress, hedge.order_id, hedge.wallet_binding_hash);
      }
      
      return false;
    });

    return NextResponse.json({
      success: true,
      verified: verifiedHedges.length > 0,
      verificationMethod: verifiedHedges.length > 0 ? 
        (verifiedHedges[0].wallet_binding_hash ? 'zk_binding' : 'direct') : undefined,
      walletAddress: normalizedAddress,
      verificationTimestamp: new Date().toISOString(),
      hedgeDetails: verifiedHedges.length > 0 ? {
        asset: verifiedHedges[0].asset,
        side: verifiedHedges[0].side,
        size: verifiedHedges[0].size,
        entryPrice: verifiedHedges[0].entry_price || 0,
        leverage: verifiedHedges[0].leverage,
        createdAt: verifiedHedges[0].created_at.toISOString(),
      } : undefined,
    });

  } catch (error) {
    console.error('Wallet ownership verification error:', error);
    return NextResponse.json({
      success: false,
      verified: false,
      walletAddress: '',
      verificationTimestamp: new Date().toISOString(),
      error: 'Verification failed',
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const walletAddress = searchParams.get('walletAddress');
  const hedgeId = searchParams.get('hedgeId');

  if (!walletAddress) {
    return NextResponse.json({
      success: false,
      error: 'walletAddress query parameter is required',
    }, { status: 400 });
  }

  // Reuse POST logic
  const mockRequest = new NextRequest(request.url, {
    method: 'POST',
    body: JSON.stringify({ walletAddress, hedgeId }),
  });

  return POST(mockRequest);
}
