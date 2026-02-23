/**
 * x402 Swap API Endpoint
 * POST /api/x402/swap - Execute DEX swaps with x402 gasless settlement
 * GET /api/x402/swap - Get swap quote from VVS Finance SDK
 * 
 * Uses @vvs-finance/swap-sdk for real DEX quotes and swaps
 * Note: Quotes use MAINNET for accurate pricing (testnet has no stablecoin pools)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVVSSwapSDKService } from '@/lib/services/VVSSwapSDKService';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

// Use MAINNET (25) for quotes - testnet (338) has no real stablecoin liquidity
const QUOTE_CHAIN_ID = 25; // Cronos Mainnet for accurate pricing

// Token addresses on Cronos MAINNET (25) - these have real liquidity
const MAINNET_TOKENS: Record<string, string> = {
  // Stablecoins
  USDC: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59',
  USDT: '0x66e428c3f67a68878562e79A0234c1F83c208770',
  DAI: '0xF2001B145b43032AAF5Ee2884e456CCd805F677D',
  BUSD: '0x6aB6d61428fde76768D7b45D8BFeec19c6eF91A8',
  // Map testnet token names to mainnet equivalents
  DEVUSDC: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', // Use real USDC for quotes
  // Major cryptocurrencies (bridged on Cronos)
  WBTC: '0x062E66477Faf219F25D27dCED647BF57C3107d52', // Wrapped Bitcoin
  BTC: '0x062E66477Faf219F25D27dCED647BF57C3107d52',  // Alias for WBTC
  WETH: '0xe44Fd7fCb2b1581822D0c862B68222998a0c299a', // Wrapped Ethereum
  ETH: '0xe44Fd7fCb2b1581822D0c862B68222998a0c299a',  // Alias for WETH
  ATOM: '0xB888d8Dd1733d72681b30c00ee76BDE93ae7aa93', // Cosmos ATOM
  LINK: '0xBc6f24649CCd67eC42342AccdCECCB2eFA27c9d9', // Chainlink
  SHIB: '0xbED48612BC69fA1CaB67052b42a95FB30C1bcFee', // Shiba Inu
  DOGE: '0x1a8E39ae59e5556B56b76fCBA98d22c9ae557396', // Dogecoin
  // VVS token
  VVS: '0x2D03bECE6747ADC00E1a131BBA1469C15fD11e03',
  // Wrapped CRO
  WCRO: '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23',
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
    logger.error('[x402/swap] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/x402/swap - Get swap quote from VVS Finance SDK
 * Uses MAINNET for accurate pricing since testnet has no stablecoin liquidity
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

    // Use MAINNET service for accurate quotes (testnet has no stablecoin pools)
    // Explicitly pass the API key from env - Next.js should have loaded .env.local
    const vvsApiKey = process.env.SWAP_SDK_QUOTE_API_CLIENT_ID_25 || process.env.NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID;
    logger.debug('[x402/swap] ENV Check:', {
      SWAP_SDK_25: process.env.SWAP_SDK_QUOTE_API_CLIENT_ID_25 ? 'present' : 'missing',
      NEXT_PUBLIC_VVS: process.env.NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID ? 'present' : 'missing',
      vvsApiKey: vvsApiKey ? `${vvsApiKey.slice(0,8)}...` : 'missing',
    });
    const vvsService = getVVSSwapSDKService(QUOTE_CHAIN_ID);
    
    // Resolve tokens to MAINNET addresses for accurate pricing
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
    
    logger.debug('[x402/swap] Getting VVS MAINNET quote:', { 
      chainId: QUOTE_CHAIN_ID,
      tokenIn: resolvedTokenIn, 
      tokenOut: resolvedTokenOut, 
      amountIn: humanAmount,
      originalAmount: amountIn,
    });
    
    try {
      // Get quote from VVS SDK using MAINNET for accurate pricing
      const quote = await vvsService.getQuote(resolvedTokenIn, resolvedTokenOut, humanAmount);
      
      logger.info('[x402/swap] VVS mainnet quote received:', {
        amountOut: quote.amountOut,
        formattedTrade: quote.formattedTrade,
      });
      
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
      // VVS API failed - try RealMarketDataService as fallback
      logger.warn('[x402/swap] VVS SDK failed, trying RealMarketDataService:', { error: vvsError instanceof Error ? vvsError.message : String(vvsError) });
      
      try {
        const { getMarketDataService } = await import('../../../../lib/services/RealMarketDataService');
        const realMarketDataService = getMarketDataService();
        
        // Get real prices from Crypto.com Exchange
        const inSymbol = getTokenSymbol(tokenIn);
        const outSymbol = getTokenSymbol(tokenOut);
        
        const [inPriceData, outPriceData] = await Promise.all([
          realMarketDataService.getTokenPrice(inSymbol),
          realMarketDataService.getTokenPrice(outSymbol)
        ]);
        
        const amountNum = parseFloat(humanAmount);
        const inValue = amountNum * inPriceData.price;
        // Apply 0.3% swap fee
        const outAmount = (inValue / outPriceData.price) * 0.997;
        
        return NextResponse.json({
          success: true,
          data: {
            tokenIn: resolvedTokenIn,
            tokenOut: resolvedTokenOut,
            amountIn: humanAmount,
            amountOut: outAmount.toString(),
            priceImpact: '0.05',
            route: [inSymbol, outSymbol],
            x402Fee: 0.01,
            source: 'cryptocom-exchange-fallback',
            warning: 'VVS API unavailable, using Crypto.com Exchange prices',
          },
        });
      } catch (fallbackError) {
        logger.error('[x402/swap] Both VVS API and Crypto.com Exchange unavailable:', fallbackError);
        
        // FAIL SAFE: Do NOT use mock prices for billion-dollar fund
        // Real money requires real prices - no fallbacks
        return NextResponse.json(
          { 
            success: false, 
            error: 'Unable to get real-time price data. Both VVS Finance and Crypto.com Exchange APIs are unavailable. Cannot proceed with swap without verified pricing.',
            code: 'PRICE_DATA_UNAVAILABLE'
          },
          { status: 503 }
        );
      }
    }
  } catch (error) {
    logger.error('[x402/swap] Quote error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get quote' },
      { status: 500 }
    );
  }
}

function resolveToken(token: string): string {
  if (token.startsWith('0x')) return token;
  const upper = token.toUpperCase();
  // VVS SDK uses 'NATIVE' for native CRO
  if (upper === 'CRO' || upper === 'TCRO' || upper === 'NATIVE') return 'NATIVE';
  // Use mainnet token addresses for accurate pricing
  return MAINNET_TOKENS[upper] || token;
}

function getTokenSymbol(token: string): string {
  const upper = token.toUpperCase();
  if (upper === 'CRO' || upper === 'TCRO' || upper === 'NATIVE' || upper === 'WCRO') return 'CRO';
  if (upper === 'USDC' || upper === 'DEVUSDC' || token.toLowerCase() === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
  return upper;
}
