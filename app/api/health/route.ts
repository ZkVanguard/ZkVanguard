import { NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { cryptocomDeveloperPlatform } from '@/lib/services/CryptocomDeveloperPlatformService';
import { cryptocomAIAgent } from '@/lib/services/CryptocomAIAgentService';

// Force dynamic rendering - health checks need runtime secrets
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health Check API for all Crypto.com services
 * GET /api/health
 */
export async function GET() {
  try {
    const startTime = Date.now();

    // Run all health checks in PARALLEL for faster response
    const [exchangeHealthy, platformResult, samplePriceResult] = await Promise.allSettled([
      cryptocomExchangeService.healthCheck(),
      cryptocomDeveloperPlatform.healthCheck().then(() => ({ healthy: true, network: 'Cronos EVM' })).catch(() => ({ healthy: false, network: 'not configured' })),
      cryptocomExchangeService.getMarketData('BTC').then(d => ({ symbol: 'BTC', price: d.price, source: d.source })).catch(() => null),
    ]);

    const exchangeStats = cryptocomExchangeService.getCacheStats();
    const isExchangeHealthy = exchangeHealthy.status === 'fulfilled' && exchangeHealthy.value;
    const platform = platformResult.status === 'fulfilled' ? platformResult.value : { healthy: false, network: 'not configured' };
    const samplePrice = samplePriceResult.status === 'fulfilled' ? samplePriceResult.value : null;
    
    // Check AI Agent (synchronous, no await needed)
    const aiAgentHealthy = cryptocomAIAgent.isReady();

    // Get sample price to test the full pipeline
    const priceFetchTime = Date.now() - startTime;

    const totalTime = Date.now() - startTime;

    const health = {
      status: isExchangeHealthy && platform.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTime: `${totalTime}ms`,
      services: {
        exchangeAPI: {
          status: isExchangeHealthy ? 'operational' : 'down',
          endpoint: 'https://api.crypto.com/exchange/v1',
          rateLimit: '100 req/sec',
          cache: {
            size: exchangeStats.size,
            symbols: exchangeStats.entries,
          },
        },
        developerPlatform: {
          status: platform.healthy ? 'operational' : 'not configured',
          network: platform.network,
          features: ['balances', 'transactions', 'blocks'],
        },
        aiAgent: {
          status: aiAgentHealthy ? 'ready' : 'not initialized',
          config: cryptocomAIAgent.getConfig(),
          features: ['natural language queries', 'blockchain operations', 'portfolio analysis'],
        },
      },
      performance: {
        samplePriceFetch: samplePrice ? { ...samplePrice, fetchTime: `${priceFetchTime}ms` } : null,
        totalHealthCheckTime: `${totalTime}ms`,
      },
      fallbackChain: [
        'Crypto.com Exchange API (primary)',
        'Crypto.com MCP Server',
        'VVS Finance',
        'Cache (stale)',
        // No mock fallback - production returns 503 if all sources fail
      ],
      contracts: {
        rwaManager: (process.env.NEXT_PUBLIC_RWAMANAGER_ADDRESS || '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189 (default)').trim(),
        zkVerifier: (process.env.NEXT_PUBLIC_ZKVERIFIER_ADDRESS || '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8 (default)').trim(),
        chainId: (process.env.NEXT_PUBLIC_CHAIN_ID || '338 (default)').trim(),
      },
      // SECURITY: Never expose which secrets are configured in production
    };

    logger.info('[Health Check] Complete', { data: health });

    return NextResponse.json(health, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    });
  } catch (error: unknown) {
    logger.error('[Health Check] Error', error);
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      },
      { status: 500 }
    );
  }
}
