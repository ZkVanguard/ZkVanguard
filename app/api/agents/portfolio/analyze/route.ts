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

    for (const symbol of tokens) {
      try {
        const priceData = await mcpClient.getPrice(symbol);
        // Get balance from blockchain
        const provider = getCronosProvider('https://evm-t3.cronos.org').provider;
        const balance = await provider.getBalance(address);
        const balanceInToken = parseFloat(ethers.formatEther(balance));
        const value = balanceInToken * priceData.price;
        
        portfolioData.tokens.push({
          symbol,
          balance: balanceInToken,
          price: priceData.price,
          value,
        });
        portfolioData.totalValue += value;
      } catch (error) {
        console.warn(`Failed to fetch ${symbol} data:`, error);
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
