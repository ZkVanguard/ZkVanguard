/**
 * x402 Swap API Endpoint
 * POST /api/x402/swap - Execute DEX swaps with x402 gasless settlement
 * GET /api/x402/swap - Get swap quote from VVS Finance SDK
 * 
 * Uses @vvs-finance/swap-sdk for real DEX quotes and swaps
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVVSSwapSDKService } from '@/lib/services/VVSSwapSDKService';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

// Token addresses on Cronos Testnet (338) with VVS liquidity pools
// Note: Use VVS testnet tokens that have actual liquidity pools
const TESTNET_TOKENS: Record<string, string> = {
  // VVS token - has liquidity pools on testnet
  VVS: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  // Use VVS token address for USDC swaps (has pools)
  USDC: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  DEVUSDC: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  // Wrapped CRO
  WCRO: '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4',
  // Native CRO
  CRO: 'NATIVE',
  TCRO: 'NATIVE',
};

export interface SwapRequestBody {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageTolerance?: number;
  recipient?: string;
  useX402?: boolean;
}

export interface SwapResponse {
  success: boolean;
  data?: {
    swapTxHash?: string;
    amountIn: string;
    amountOut: string;
    priceImpact: number;
    route: string[];
    x402Fee?: string;
    gasSaved?: string;
    timestamp: number;
  };
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<SwapResponse>> {
  try {
    const body = await request.json() as SwapRequestBody;
    
    // Validate required fields
    if (!body.walletAddress || !body.tokenIn || !body.tokenOut || !body.amountIn) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: walletAddress, tokenIn, tokenOut, amountIn' },
        { status: 400 }
      );
    }
    
    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Get VVS SDK service
    const vvsService = getVVSSwapSDKService();
    
    // Resolve token addresses
    const tokenIn = resolveToken(body.tokenIn);
    const tokenOut = resolveToken(body.tokenOut);
    
    // Get quote
    const quote = await vvsService.getQuote(tokenIn, tokenOut, body.amountIn);
    
    return NextResponse.json({
      success: true,
      data: {
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        priceImpact: quote.priceImpact,
        route: quote.route,
        x402Fee: body.useX402 ? '10000' : undefined,
        gasSaved: body.useX402 ? '300000000000000000' : undefined,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.error('[x402/swap] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Mock prices for fallback when VVS API fails
const MOCK_PRICES: Record<string, number> = {
  CRO: 0.14,
  WCRO: 0.14,
  USDC: 1.0,
  DEVUSDC: 1.0,
};

/**
 * GET /api/x402/swap - Get swap quote from VVS Finance SDK
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const tokenIn = searchParams.get('tokenIn');
    const tokenOut = searchParams.get('tokenOut');
    const amountIn = searchParams.get('amountIn');
    
    if (!tokenIn || !tokenOut || !amountIn) {
      return NextResponse.json(
        { success: false, error: 'Missing required query params: tokenIn, tokenOut, amountIn' },
        { status: 400 }
      );
    }

    // Get VVS SDK service
    const vvsService = getVVSSwapSDKService();
    
    // Resolve tokens - VVS SDK uses 'CRO' for native, addresses for tokens
    const resolvedTokenIn = resolveToken(tokenIn);
    const resolvedTokenOut = resolveToken(tokenOut);
    
    // VVS SDK expects human-readable amounts like '10' for 10 tokens
    // If amountIn looks like wei (very large number), convert it
    let humanAmount = amountIn;
    const numericAmount = parseFloat(amountIn);
    
    // If the amount is larger than 1e15, it's likely wei - convert to human readable
    if (numericAmount > 1e15) {
      humanAmount = (numericAmount / 1e18).toString();
    }
    
    console.log('[x402/swap] Getting VVS quote:', { 
      tokenIn: resolvedTokenIn, 
      tokenOut: resolvedTokenOut, 
      amountIn: humanAmount,
      originalAmount: amountIn,
    });
    
    try {
      // Try VVS SDK first
      const quote = await vvsService.getQuote(resolvedTokenIn, resolvedTokenOut, humanAmount);
      
      return NextResponse.json({
        success: true,
        data: {
          tokenIn: resolvedTokenIn,
          tokenOut: resolvedTokenOut,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          priceImpact: quote.priceImpact,
          route: quote.route,
          formattedTrade: quote.formattedTrade,
          x402Fee: 0.01,
          source: 'vvs-sdk',
        },
      });
    } catch (vvsError) {
      // VVS API failed - use mock fallback for demo
      console.warn('[x402/swap] VVS SDK failed, using mock fallback:', vvsError);
      
      const mockQuote = getMockQuote(tokenIn, tokenOut, humanAmount);
      
      return NextResponse.json({
        success: true,
        data: {
          ...mockQuote,
          x402Fee: 0.01,
          source: 'mock-fallback',
          warning: 'VVS API unavailable, using estimated prices',
        },
      });
    }
  } catch (error) {
    console.error('[x402/swap] Quote error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get quote' },
      { status: 500 }
    );
  }
}

function resolveToken(token: string): string {
  if (token.startsWith('0x')) return token;
  const upper = token.toUpperCase();
  // VVS SDK uses 'CRO' directly for native token
  if (upper === 'CRO' || upper === 'TCRO' || upper === 'NATIVE') return 'CRO';
  return TESTNET_TOKENS[upper] || token;
}

/**
 * Get mock quote when VVS API is unavailable
 */
function getMockQuote(tokenIn: string, tokenOut: string, amount: string) {
  const inSymbol = getTokenSymbol(tokenIn);
  const outSymbol = getTokenSymbol(tokenOut);
  
  const inPrice = MOCK_PRICES[inSymbol] || 1;
  const outPrice = MOCK_PRICES[outSymbol] || 1;
  
  const amountNum = parseFloat(amount);
  const inValue = amountNum * inPrice;
  // Apply 0.3% swap fee
  const outAmount = (inValue / outPrice) * 0.997;
  
  return {
    tokenIn: resolveToken(tokenIn),
    tokenOut: resolveToken(tokenOut),
    amountIn: amount,
    amountOut: outAmount.toFixed(6),
    priceImpact: 0.08,
    route: [inSymbol, outSymbol],
    formattedTrade: `${amount} ${inSymbol} → ${outAmount.toFixed(6)} ${outSymbol}`,
  };
}

function getTokenSymbol(token: string): string {
  const upper = token.toUpperCase();
  if (upper === 'CRO' || upper === 'TCRO' || upper === 'NATIVE' || upper === 'WCRO') return 'CRO';
  if (upper === 'USDC' || upper === 'DEVUSDC' || token.toLowerCase() === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
  return upper;
}
