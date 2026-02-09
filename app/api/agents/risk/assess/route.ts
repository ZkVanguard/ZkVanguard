import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { MCPClient } from '@/integrations/mcp/MCPClient';
import { ethers } from 'ethers';
import type { PortfolioData } from '@/shared/types/portfolio';
import { getCronosProvider } from '@/lib/throttled-provider';

/**
 * Risk Assessment API Route
 * Uses HACKATHON-PROVIDED services:
 * - Crypto.com AI SDK (FREE for hackathon)
 * - Crypto.com MCP (FREE market data with historical prices)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, portfolioValue, positions } = body;

    // Support simulation mode with direct portfolio data (no address required)
    if (portfolioValue && positions && !address) {
      const aiService = getCryptocomAIService();
      
      // Build portfolio data from provided positions
      // Note: calculateRealRiskAssessment expects `usdValue` field
      const portfolioData: PortfolioData = {
        address: '0xSimulation',
        tokens: positions.map((p: { symbol: string; value: number }) => ({
          symbol: p.symbol,
          balance: p.value / 100000, // Approximate balance
          price: p.symbol === 'BTC' ? 84050 : p.symbol === 'ETH' ? 3037 : 0.12,
          value: p.value,
          usdValue: p.value, // Required for risk calculation
        })),
        totalValue: portfolioValue,
      };

      // Use AI SDK for risk assessment
      const riskAssessment = await aiService.assessRisk(portfolioData);

      return NextResponse.json({
        var: riskAssessment.var95 ?? 0.068, // Default 6.8% VaR
        volatility: riskAssessment.volatility ?? 0.45, // Default 45% volatility
        sharpeRatio: riskAssessment.sharpeRatio ?? 0.12,
        riskScore: riskAssessment.riskScore ?? 65, // Default moderate risk
        overallRisk: riskAssessment.overallRisk ?? 'medium',
        factors: riskAssessment.factors,
        realAgent: aiService.isAvailable(),
        simulationMode: true,
        hackathonAPIs: {
          aiSDK: 'Crypto.com AI Agent SDK (FREE)',
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required (or provide portfolioValue + positions for simulation)' },
        { status: 400 }
      );
    }

    // Get market data from Crypto.com MCP (FREE hackathon service)
    const mcpClient = new MCPClient();
    await mcpClient.connect();
    
    // Fetch portfolio and historical data using MCP
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

    const volatilities = new Map<string, number>();
    const provider = getCronosProvider('https://evm-t3.cronos.org').provider;

    // Fetch all token data in parallel
    const tokenResults = await Promise.allSettled(
      tokens.map(async (symbol) => {
        try {
          const priceData = await mcpClient.getPrice(symbol);
          const historicalData = await mcpClient.getHistoricalPrices(symbol, '1d');
          
          // Calculate volatility from historical prices
          if (historicalData && historicalData.length > 1) {
            const returns = [];
            for (let i = 1; i < historicalData.length; i++) {
              returns.push((historicalData[i].price - historicalData[i-1].price) / historicalData[i-1].price);
            }
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
            const volatility = Math.sqrt(variance) * Math.sqrt(252);
            volatilities.set(symbol, volatility);
          }

          // Get correct balance per token type
          let balanceInToken = 0;
          if (symbol === 'CRO') {
            // CRO is the native currency — use getBalance
            const balance = await provider.getBalance(address);
            balanceInToken = parseFloat(ethers.formatEther(balance));
          } else if (TOKEN_ADDRESSES[symbol]) {
            // Known ERC20 token — use balanceOf
            const tokenContract = new ethers.Contract(TOKEN_ADDRESSES[symbol], ERC20_ABI, provider);
            const balance = await tokenContract.balanceOf(address);
            balanceInToken = parseFloat(ethers.formatUnits(balance, TOKEN_DECIMALS[symbol] || 18));
          } else {
            // BTC/ETH — user likely doesn't hold native BTC/ETH on Cronos; value is 0
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

    // Use Crypto.com AI SDK for risk assessment (FREE hackathon service)
    const aiService = getCryptocomAIService();
    const riskAssessment = await aiService.assessRisk(portfolioData);

    const riskMetrics = {
      var: riskAssessment.var95,
      volatility: riskAssessment.volatility,
      sharpeRatio: riskAssessment.sharpeRatio,
      liquidationRisk: riskAssessment.riskScore > 70 ? 0.08 : riskAssessment.riskScore > 50 ? 0.05 : 0.02,
      healthScore: 100 - riskAssessment.riskScore,
      overallRisk: riskAssessment.overallRisk,
      riskScore: riskAssessment.riskScore,
      factors: riskAssessment.factors,
      recommendations: [
        `Overall risk level: ${riskAssessment.overallRisk}`,
        `Risk score: ${riskAssessment.riskScore.toFixed(1)}/100`,
        `Portfolio volatility: ${(riskAssessment.volatility * 100).toFixed(1)}%`,
        ...riskAssessment.factors.map(f => `${f.factor}: ${f.description}`),
      ],
      hackathonAPIs: {
        aiSDK: 'Crypto.com AI Agent SDK (FREE)',
        marketData: 'Crypto.com MCP (FREE with historical data)',
      },
      realAgent: aiService.isAvailable(),
      realMarketData: true,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(riskMetrics);
  } catch (error) {
    console.error('Risk assessment error:', error);
    return NextResponse.json(
      { error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Risk Agent API operational' });
}
