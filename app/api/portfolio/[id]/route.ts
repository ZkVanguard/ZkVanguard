import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // In Next.js 14+, params is a Promise
    const { id } = await context.params;
    const portfolioId = BigInt(id);
    
    console.log(`[Portfolio API] Fetching portfolio ${portfolioId}...`);
    
    // Create public client for Cronos Testnet
    const client = createPublicClient({
      chain: cronosTestnet,
      transport: http('https://evm-t3.cronos.org'),
    });

    const addresses = getContractAddresses(338); // Cronos Testnet chain ID
    console.log(`[Portfolio API] Using RWA Manager: ${addresses.rwaManager}`);

    // Read portfolio data from contract using 'portfolios' mapping getter
    const portfolio = await client.readContract({
      address: addresses.rwaManager as `0x${string}`,
      abi: RWA_MANAGER_ABI,
      functionName: 'portfolios',
      args: [portfolioId],
    }) as [string, bigint, bigint, bigint, bigint, boolean];

    console.log(`[Portfolio API] Raw portfolio data:`, portfolio);

    // Also fetch asset list
    const assets = await client.readContract({
      address: addresses.rwaManager as `0x${string}`,
      abi: RWA_MANAGER_ABI,
      functionName: 'getPortfolioAssets',
      args: [portfolioId],
    }) as string[];

    console.log(`[Portfolio API] Portfolio assets:`, assets);

    // Format response
    const portfolioData = {
      owner: portfolio[0],
      totalValue: portfolio[1]?.toString() || '0',
      targetYield: portfolio[2]?.toString() || '0',
      riskTolerance: portfolio[3]?.toString() || '0',
      lastRebalance: portfolio[4]?.toString() || '0',
      isActive: portfolio[5] ?? false,
      assets: assets || [],
    };

    return NextResponse.json(portfolioData);
  } catch (error: any) {
    console.error('[Portfolio API] Error fetching portfolio:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio data', details: error?.message },
      { status: 500 }
    );
  }
}
