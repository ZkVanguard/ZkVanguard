import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getHedgeByZkProofHash, getHedgeById } from '@/lib/db/hedges';
import { getCronosProvider } from '@/lib/throttled-provider';

const RPC_URL = process.env.RPC_URL || 'https://evm-t3.cronos.org';
const X402_VERIFIER_ADDRESS = process.env.NEXT_PUBLIC_X402_GASLESS_VERIFIER || '0x85bC6BE2ee9AD8E0f48e94Eae90464723EE4E852';

// ABI for decoding transaction and reading events
const X402_VERIFIER_ABI = [
  'function storeCommitmentWithUSDC(bytes32 proofHash, bytes32 merkleRoot, uint256 securityLevel)',
  'event CommitmentStored(bytes32 indexed proofHash, bytes32 indexed merkleRoot, address indexed verifier, uint256 timestamp, uint256 securityLevel, uint256 usdcFee)',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { txHash, proofHash, hedgeId } = body;

    // If proofHash is provided, look up in database
    if (proofHash) {
      try {
        // First try to find by proof hash (checks both zk_proof_hash and tx_hash columns)
        const hedge = await getHedgeByZkProofHash(proofHash);
        
        if (hedge) {
          // Return proof hash from either column
          const actualProofHash = hedge.zk_proof_hash || hedge.tx_hash;
          const metadata = hedge.metadata as Record<string, unknown> | null;
          return NextResponse.json({
            success: true,
            found: true,
            hedgeId: hedge.order_id,
            hedgeDetails: {
              asset: hedge.asset,
              side: hedge.side,
              size: hedge.size,
              entryPrice: hedge.entry_price,
              leverage: hedge.leverage,
              status: hedge.status,
              createdAt: hedge.created_at,
              simulationMode: hedge.simulation_mode,
            },
            proofHash: actualProofHash,
            walletAddress: hedge.wallet_address,
            ownerWallet: metadata?.ownerWallet as string || hedge.wallet_address,
            proxyWallet: metadata?.proxyWallet as string || null,
            walletBindingHash: hedge.wallet_binding_hash,
            ownerCommitment: hedge.owner_commitment,
          });
        }

        // If not found by proof hash, try by hedge ID if provided
        if (hedgeId) {
          const hedgeById = await getHedgeById(hedgeId);
          const hedgeProofHash = hedgeById?.zk_proof_hash || hedgeById?.tx_hash;
          if (hedgeById && hedgeProofHash === proofHash) {
            const metadata = hedgeById.metadata as Record<string, unknown> | null;
            return NextResponse.json({
              success: true,
              found: true,
              hedgeId: hedgeById.order_id,
              hedgeDetails: {
                asset: hedgeById.asset,
                side: hedgeById.side,
                size: hedgeById.size,
                entryPrice: hedgeById.entry_price,
                leverage: hedgeById.leverage,
                status: hedgeById.status,
                createdAt: hedgeById.created_at,
                simulationMode: hedgeById.simulation_mode,
              },
              proofHash: hedgeProofHash,
              walletAddress: hedgeById.wallet_address,
              ownerWallet: metadata?.ownerWallet as string || hedgeById.wallet_address,
              proxyWallet: metadata?.proxyWallet as string || null,
              walletBindingHash: hedgeById.wallet_binding_hash,
              ownerCommitment: hedgeById.owner_commitment,
            });
          }
        }

        return NextResponse.json({
          success: true,
          found: false,
          error: 'No hedge found with this proof hash',
        });
      } catch (dbError) {
        console.error('Database lookup error:', dbError);
        return NextResponse.json({
          success: false,
          found: false,
          error: 'Database lookup failed',
        }, { status: 500 });
      }
    }

    // If txHash is provided, look up on-chain
    if (!txHash || !txHash.startsWith('0x')) {
      return NextResponse.json(
        { success: false, error: 'Valid transaction hash (0x...) or proof hash is required' },
        { status: 400 }
      );
    }

    const provider = getCronosProvider(RPC_URL).provider;
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    if (receipt.status !== 1) {
      return NextResponse.json(
        { success: false, error: 'Transaction failed on-chain' },
        { status: 400 }
      );
    }

    // Check if this transaction was to our verifier contract
    if (receipt.to?.toLowerCase() !== X402_VERIFIER_ADDRESS.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Transaction is not a ZK commitment storage' },
        { status: 400 }
      );
    }

    // Parse the CommitmentStored event
    const iface = new ethers.Interface(X402_VERIFIER_ABI);
    const commitmentStoredTopic = iface.getEvent('CommitmentStored')?.topicHash;
    
    let commitment = null;
    
    for (const log of receipt.logs) {
      if (log.topics[0] === commitmentStoredTopic) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed) {
            commitment = {
              proofHash: parsed.args[0], // proofHash (indexed)
              merkleRoot: parsed.args[1], // merkleRoot (indexed)
              verifier: parsed.args[2], // verifier address (indexed)
              timestamp: Number(parsed.args[3]), // timestamp
              securityLevel: Number(parsed.args[4]), // securityLevel
              usdcFee: ethers.formatUnits(parsed.args[5], 6), // USDC has 6 decimals
              verified: true,
              txHash,
              blockNumber: receipt.blockNumber,
            };
            break;
          }
        } catch {
          // Try decoding from transaction input if event parsing fails
        }
      }
    }

    // If no event found, try to decode from transaction input
    if (!commitment) {
      const tx = await provider.getTransaction(txHash);
      if (tx?.data) {
        try {
          const decoded = iface.parseTransaction({ data: tx.data });
          if (decoded && decoded.name === 'storeCommitmentWithUSDC') {
            // Get USDC transfer amount from logs (ERC-20 Transfer event)
            let usdcFee = '0.01'; // Default
            const transferTopic = ethers.id('Transfer(address,address,uint256)');
            for (const log of receipt.logs) {
              if (log.topics[0] === transferTopic) {
                const amount = BigInt(log.data);
                usdcFee = ethers.formatUnits(amount, 6);
                break;
              }
            }

            // Get block timestamp and block number in parallel
            const [block, currentBlockNumber] = await Promise.all([
              provider.getBlock(receipt.blockNumber),
              provider.getBlockNumber(),
            ]);
            
            commitment = {
              proofHash: decoded.args[0],
              merkleRoot: decoded.args[1],
              securityLevel: Number(decoded.args[2]),
              timestamp: block?.timestamp || Math.floor(Date.now() / 1000),
              usdcFee,
              verified: true,
              txHash,
              blockNumber: receipt.blockNumber,
              blockConfirmations: currentBlockNumber - receipt.blockNumber,
            };
          }
        } catch (decodeErr) {
          console.error('Failed to decode transaction:', decodeErr);
        }
      }
    }

    if (!commitment) {
      return NextResponse.json(
        { success: false, error: 'Could not parse commitment from transaction' },
        { status: 400 }
      );
    }

    // blockConfirmations already computed above when available
    const blockConfirmations = (commitment as Record<string, unknown>).blockConfirmations 
      ?? (await provider.getBlockNumber()) - receipt.blockNumber;

    return NextResponse.json({
      success: true,
      commitment,
      blockConfirmations,
    });

  } catch (error) {
    console.error('Lookup error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to lookup proof',
      },
      { status: 500 }
    );
  }
}
