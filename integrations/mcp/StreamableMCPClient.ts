/**
 * Streamable HTTP MCP Client for Crypto.com Market Data
 * 
 * Uses the official Model Context Protocol SDK to connect to Crypto.com's
 * FREE market data MCP server via Streamable HTTP transport.
 * 
 * No API key required - public hackathon access!
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '../../shared/utils/logger';

export interface MCPPriceData {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
  priceChange24h?: number;
  marketCap?: number;
}

export interface MCPMarketData {
  prices: Record<string, number>;
  volumes: Record<string, number>;
  marketCaps: Record<string, number>;
  timestamp: number;
}

class StreamableMCPClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected: boolean = false;
  private priceCache: Map<string, MCPPriceData> = new Map();
  private readonly MCP_SERVER_URL = 'https://mcp.crypto.com/market-data/mcp';

  constructor() {
    // Disabled for now - MCP is designed for Claude Desktop integration, not direct programmatic access
    // console.log('✅ Crypto.com MCP Client initialized (Streamable HTTP, FREE hackathon access)');
  }

  /**
   * Connect to Crypto.com MCP server via Streamable HTTP
   * Note: Currently disabled - MCP endpoint is for Claude Desktop, not direct API access
   */
  async connect(): Promise<void> {
    // Disabled - MCP is for Claude Desktop integration
    throw new Error('MCP direct connection not available - using Exchange API fallback');
    
    if (this.connected && this.client) {
      return; // Already connected
    }

    try {
      logger.info('Connecting to Crypto.com MCP via Streamable HTTP', {
        url: this.MCP_SERVER_URL,
      });

      // Create Streamable HTTP transport
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.MCP_SERVER_URL)
      ) as unknown as typeof this.transport;

      // Create MCP client
      this.client = new Client({
        name: 'ZkVanguard',
        version: '1.0.0',
      }, {
        capabilities: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as Record<string, unknown>);

      // Connect client to transport
      if (!this.transport || !this.client) {
        throw new Error('Transport or client not initialized');
      }
      
      const transport = this.transport as StreamableHTTPClientTransport;
      const client = this.client as Client;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);

      this.connected = true;
      logger.info('✅ Connected to Crypto.com MCP via Streamable HTTP');

      // List available tools
      const toolsResult = await client.listTools();
      logger.info('Available MCP tools', {
        tools: toolsResult.tools.map(t => t.name),
      });

    } catch (error) {
      logger.error('Failed to connect to Crypto.com MCP', { error });
      this.connected = false;
      throw error;
    }
  }

  /**
   * Get current price for a symbol using MCP tools
   */
  async getPrice(symbol: string): Promise<MCPPriceData> {
    // Check cache first (60-second TTL)
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached;
    }

    // Ensure connection
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Call MCP tool to get price
      const result = await this.client!.callTool({
        name: 'get_price',
        arguments: {
          symbol: symbol.toUpperCase(),
        },
      });

      // Parse result
      const content = result.content as Array<{ text?: string }>;
      const priceData: MCPPriceData = {
        symbol,
        price: content?.[0]?.text ? parseFloat(content[0].text) : 0,
        timestamp: Date.now(),
      };

      // Cache the result
      this.priceCache.set(symbol, priceData);

      logger.debug('Fetched price from MCP', { symbol, price: priceData.price });

      return priceData;
    } catch (error) {
      logger.error('Failed to fetch price from MCP', { symbol, error });
      throw error;
    }
  }

  /**
   * Get prices for multiple symbols
   */
  async getPrices(symbols: string[]): Promise<MCPPriceData[]> {
    const promises = symbols.map(symbol => this.getPrice(symbol));
    return await Promise.all(promises);
  }

  /**
   * Get market data for multiple symbols
   */
  async getMarketData(symbols: string[]): Promise<MCPMarketData> {
    const prices = await this.getPrices(symbols);

    return {
      prices: Object.fromEntries(prices.map(p => [p.symbol, p.price])),
      volumes: Object.fromEntries(prices.map(p => [p.symbol, p.volume24h || 0])),
      marketCaps: Object.fromEntries(prices.map(p => [p.symbol, p.marketCap || 0])),
      timestamp: Date.now(),
    };
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
      this.connected = false;
      this.priceCache.clear();
      logger.info('Disconnected from Crypto.com MCP');
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }
}

// Singleton instance
export const streamableMCPClient = new StreamableMCPClient();
export default streamableMCPClient;

