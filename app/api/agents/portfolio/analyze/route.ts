import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { MCPClient } from '@/integrations/mcp/MCPClient';
import { ethers } from 'ethers';
import type { PortfolioData } from '@/shared/types/portfolio';
import { getCronosProvider } from '@/lib/throttled-provider';

/**
 * AI-Powered Portfolio Analysis API
 * Uses HACKATHON-PROVIDED services:
 * - Crypto.com AI SDK (FREE for hackathon)
 * - Crypto.com MCP (FREE market data)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Get market data from Crypto.com MCP (FREE hackathon service)
    const mcpClient = new MCPClient();
    await mcpClient.connect();
    
    // Fetch portfolio data using MCP
    const tokens = ['CRO', 'BTC', 'ETH', 'USDC', 'USDT'];
    const portfolioData: PortfolioData = {
      address,
      tokens: [],
      totalValue: 0,
    };

    // Known token addresses on Cronos testnet for ERC20 balance lookups
    const TOKEN_ADDRESSES: Record<string, string> = {
      USDC: '0x28217DAddC55e3C4831b4A48A00Ce04880786967',
      USDT: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    };
    const TOKEN_DECIMALS: Record<string, number> = {
      CRO: 18, BTC: 8, ETH: 18, USDC: 6, USDT: 6,
    };
    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
    const provider = getCronosProvider('https://evm-t3.cronos.org').provider;

    // Fetch all token data in parallel
    const tokenResults = await Promise.allSettled(
      tokens.map(async (symbol) => {
        try {
          const priceData = await mcpClient.getPrice(symbol);

          // Get correct balance per token type
          let balanceInToken = 0;
          if (symbol === 'CRO') {
            const balance = await provider.getBalance(address);
            balanceInToken = parseFloat(ethers.formatEther(balance));
          } else if (TOKEN_ADDRESSES[symbol]) {
            const tokenContract = new ethers.Contract(TOKEN_ADDRESSES[symbol], ERC20_ABI, provider);
            const balance = await tokenContract.balanceOf(address);
            balanceInToken = parseFloat(ethers.formatUnits(balance, TOKEN_DECIMALS[symbol] || 18));
          } else {
            balanceInToken = 0;
          }
          const value = balanceInToken * priceData.price;
          
          return {
            symbol,
            balance: balanceInToken,
            price: priceData.price,
            value,
          };
        } catch (error) {
          console.warn(`Failed to fetch ${symbol} data:`, error);
          return null;
        }
      })
    );

    for (const result of tokenResults) {
      if (result.status === 'fulfilled' && result.value) {
        portfolioData.tokens.push(result.value);
        portfolioData.totalValue += result.value.value;
      }
    }

    // Use Crypto.com AI SDK for analysis (FREE hackathon service)
    const aiService = getCryptocomAIService();
    const analysis = await aiService.analyzePortfolio(address, portfolioData);

    return NextResponse.json({
      success: true,
      analysis: {
        ...analysis,
        tokens: portfolioData.tokens,
        totalValue: portfolioData.totalValue,
      },
      hackathonAPIs: {
        aiSDK: 'Crypto.com AI Agent SDK (FREE)',
        marketData: 'Crypto.com MCP (FREE)',
      },
      realAgent: aiService.isAvailable(),
      realMarketData: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Portfolio analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Portfolio analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const aiService = getCryptocomAIService();
  return NextResponse.json({
    status: 'AI Portfolio Analysis API operational',
    hackathonAPIs: {
      'Crypto.com AI SDK': aiService.isAvailable() ? '✅ Active (FREE)' : '⚠️ Fallback mode',
      'Crypto.com MCP': '✅ Available (FREE market data)',
    },
    note: 'Using hackathon-provided FREE APIs from Crypto.com',
  });
}
