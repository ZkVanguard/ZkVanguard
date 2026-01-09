import { NextResponse } from 'next/server';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { cryptocomDeveloperPlatform } from '@/lib/services/CryptocomDeveloperPlatformService';
import { cryptocomAIAgent } from '@/lib/services/CryptocomAIAgentService';

/**
 * Health Check API for all Crypto.com services
 * GET /api/health
 */
export async function GET() {
  try {
    console.log('[Health Check] Starting comprehensive health check...');
    const startTime = Date.now();

    // Check Exchange API
    const exchangeHealthy = await cryptocomExchangeService.healthCheck();
    const exchangeStats = cryptocomExchangeService.getCacheStats();

    // Check Developer Platform
    let platformHealthy = false;
    let platformNetwork = 'not configured';
    try {
      platformHealthy = await cryptocomDeveloperPlatform.healthCheck();
      platformNetwork = 'Cronos EVM';
    } catch (error) {
      console.log('[Health Check] Developer Platform not configured');
    }
    
    // Check AI Agent
    const aiAgentHealthy = cryptocomAIAgent.isReady();

    // Get sample price to test the full pipeline
    let samplePrice = null;
    let priceFetchTime = 0;
    try {
      const priceStart = Date.now();
      const btcData = await cryptocomExchangeService.getMarketData('BTC');
      priceFetchTime = Date.now() - priceStart;
      samplePrice = {
        symbol: 'BTC',
        price: btcData.price,
        source: btcData.source,
        fetchTime: `${priceFetchTime}ms`,
      };
    } catch (error) {
      console.error('[Health Check] Sample price fetch failed:', error);
    }

    const totalTime = Date.now() - startTime;

    const health = {
      status: exchangeHealthy && platformHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTime: `${totalTime}ms`,
      services: {
        exchangeAPI: {
          status: exchangeHealthy ? 'operational' : 'down',
          endpoint: 'https://api.crypto.com/exchange/v1',
          rateLimit: '100 req/sec',
          cache: {
            size: exchangeStats.size,
            symbols: exchangeStats.entries,
          },
        },
        developerPlatform: {
          status: platformHealthy ? 'operational' : 'not configured',
          network: platformNetwork,
          features: ['balances', 'transactions', 'blocks'],
        },
        aiAgent: {
          status: aiAgentHealthy ? 'ready' : 'not initialized',
          config: cryptocomAIAgent.getConfig(),
          features: ['natural language queries', 'blockchain operations', 'portfolio analysis'],
        },
      },
      performance: {
        samplePriceFetch: samplePrice,
        totalHealthCheckTime: `${totalTime}ms`,
      },
      fallbackChain: [
        'Crypto.com Exchange API (primary)',
        'Crypto.com MCP Server',
        'VVS Finance',
        'Cache (stale)',
        'Mock data',
      ],
    };

    console.log('[Health Check] Complete:', JSON.stringify(health, null, 2));

    return NextResponse.json(health);
  } catch (error: any) {
    console.error('[Health Check] Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 500 }
    );
  }
}
