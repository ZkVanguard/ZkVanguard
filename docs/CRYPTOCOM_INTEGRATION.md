# Crypto.com Integration Guide

## Overview

This project now integrates the full suite of Crypto.com developer tools to provide comprehensive blockchain functionality on Cronos EVM and zkEVM:

1. **Crypto.com Exchange API** - Real-time market data (100 req/s)
2. **Crypto.com Developer Platform Client** - On-chain data queries
3. **Crypto.com AI Agent SDK** - Natural language blockchain operations
4. **Crypto.com Market Data MCP Server** - Additional market data source

## Quick Start

### 1. Get API Keys

#### Crypto.com Developer Platform API Key
1. Visit https://developers.zkevm.cronos.org/user/apikeys
2. Sign in with your Crypto.com account
3. Create a new API key
4. Copy the API key to your `.env.local`:
```bash
DASHBOARD_API_KEY=your_api_key_here
CRYPTOCOM_DEVELOPER_API_KEY=your_api_key_here
```

#### OpenAI API Key (Required for AI Agent)
1. Visit https://platform.openai.com/api-keys
2. Create a new API key
3. Add to `.env.local`:
```bash
OPENAI_API_KEY=your_openai_api_key
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
# Crypto.com Developer Platform
DASHBOARD_API_KEY=your_crypto_com_api_key
CRYPTOCOM_DEVELOPER_API_KEY=your_crypto_com_api_key

# AI Services
OPENAI_API_KEY=your_openai_api_key

# Blockchain Configuration
CRONOS_RPC_URL=https://evm-t3.cronos.org
CRONOS_CHAIN_ID=338

# Your wallet private key (for transactions)
PRIVATE_KEY=your_private_key_here
```

### 3. Install Dependencies

```bash
npm install
```

## Services Architecture

### 1. Crypto.com Exchange API Service

**File:** `lib/services/CryptocomExchangeService.ts`

**Features:**
- Real-time crypto prices (BTC, ETH, CRO, etc.)
- 100 requests/second rate limit
- 30-second caching
- Batch price fetching
- 24h market statistics

**Usage:**
```typescript
import { cryptocomExchange } from '@/lib/services/CryptocomExchangeService';

// Get single price
const btcPrice = await cryptocomExchange.getPrice('BTC');
console.log(`BTC: $${btcPrice}`);

// Get market data with 24h stats
const marketData = await cryptocomExchange.getMarketData('ETH');
console.log(`ETH: $${marketData.price}, 24h: ${marketData.change24h}%`);

// Batch fetch multiple prices
const prices = await cryptocomExchange.getBatchPrices(['BTC', 'ETH', 'CRO']);
console.log('Prices:', prices);

// Get all available tickers
const tickers = await cryptocomExchange.getAllTickers();
```

**Supported Symbols:**
- BTC, BITCOIN → BTC_USD
- ETH, ETHEREUM → ETH_USD
- CRO, CRONOS → CRO_USD
- USDC, USDT, DAI (stablecoins)
- And many more...

### 2. Developer Platform Client Service

**File:** `lib/services/CryptocomDeveloperPlatformService.ts`

**Features:**
- Native balance (CRO) queries
- ERC-20 token balances
- Transaction history
- Block information
- Multi-network support

**Usage:**
```typescript
import { cryptocomPlatform } from '@/lib/services/CryptocomDeveloperPlatformService';

// Initialize (automatic on first use)
await cryptocomPlatform.initialize({
  apiKey: process.env.DASHBOARD_API_KEY,
  network: 'CronosEvm.Testnet' // or 'CronosEvm.Mainnet', 'CronosZkEvm.Mainnet', etc.
});

// Get CRO balance
const balance = await cryptocomPlatform.getNativeBalance('0x...');
console.log(`CRO Balance: ${balance.balanceFormatted} CRO`);

// Get ERC-20 token balance
const usdcBalance = await cryptocomPlatform.getTokenBalance(
  '0x...', // wallet address
  '0x...'  // token contract address
);

// Get transaction details
const tx = await cryptocomPlatform.getTransaction('0xtxhash...');
console.log(`Status: ${tx.status}, Gas: ${tx.gasUsed}`);

// Get transaction history
const history = await cryptocomPlatform.getAddressTransactions('0x...', 10);

// Get latest block
const block = await cryptocomPlatform.getLatestBlock();
console.log(`Block: ${block.number}, Timestamp: ${block.timestamp}`);

// Switch networks
await cryptocomPlatform.switchNetwork('CronosZkEvm.Mainnet');
```

**Supported Networks:**
- `CronosEvm.Mainnet` (Chain ID: 25)
- `CronosEvm.Testnet` (Chain ID: 338)
- `CronosZkEvm.Mainnet` (Chain ID: 388)
- `CronosZkEvm.Testnet` (Chain ID: 240)

### 3. AI Agent Service

**File:** `lib/services/CryptocomAIAgentService.ts`

**Features:**
- Natural language blockchain queries
- AI-powered transaction execution
- Portfolio analysis with insights
- Risk assessment
- Smart contract interaction

**Usage:**
```typescript
import { cryptocomAIAgent } from '@/lib/services/CryptocomAIAgentService';

// Initialize (automatic on first use)
await cryptocomAIAgent.initialize({
  openaiApiKey: process.env.OPENAI_API_KEY,
  chainId: '338', // Cronos Testnet
  dashboardApiKey: process.env.DASHBOARD_API_KEY,
});

// Natural language queries
const result = await cryptocomAIAgent.query(
  "What is the current gas price on Cronos?"
);
console.log(result.response);

// Send tokens with AI
const sendResult = await cryptocomAIAgent.sendTokens(
  '0xRecipientAddress',
  10,
  'CRO'
);
console.log(sendResult.txHash);

// Analyze portfolio
const analysis = await cryptocomAIAgent.analyzePortfolio('0xYourAddress');
console.log(analysis.response);

// Swap tokens
const swapResult = await cryptocomAIAgent.swapTokens('CRO', 'USDC', 100);

// Risk assessment
const risk = await cryptocomAIAgent.assessRisk(
  '0xYourAddress',
  'swap 1000 CRO for USDC'
);
console.log(risk.response);

// Transaction analysis
const txAnalysis = await cryptocomAIAgent.analyzeTransaction('0xtxhash...');

// Get contract information
const contract = await cryptocomAIAgent.getContractInfo('0xContractAddress');
```

### 4. Multi-Source Market Data Service

**File:** `lib/services/RealMarketDataService.ts`

**Features:**
- 6-tier fallback system for maximum reliability
- Automatic source switching
- Intelligent caching
- Rate limit handling

**Fallback Priority:**
1. **Crypto.com Exchange API** (Primary - 100 req/s)
2. **Crypto.com MCP Server** (Free, no limits)
3. **VVS Finance** (CRC20 tokens on Cronos)
4. **Stale Cache** (If all sources fail)
5. **Mock Prices** (Last resort)

**Usage:**
```typescript
import { realMarketDataService } from '@/lib/services/RealMarketDataService';

// Get single token price (automatically uses best source)
const price = await realMarketDataService.getTokenPrice('BTC');
console.log(`BTC: $${price.price} from ${price.source}`);

// Get multiple prices in parallel
const prices = await realMarketDataService.getTokenPrices(['BTC', 'ETH', 'CRO']);
prices.forEach((price, symbol) => {
  console.log(`${symbol}: $${price.price} from ${price.source}`);
});
```

**Source Examples:**
- `cryptocom-exchange` - Primary source (fastest, most reliable)
- `cryptocom-mcp` - MCP Server fallback
- `vvs` - Cronos-native tokens
- `cache` - Fresh cached data
- `stale_cache` - Old cached data (during outages)
- `mock` - Test/development data

## Rate Limits & Performance

### Crypto.com Exchange API
- **Rate Limit:** 100 requests/second
- **Cache TTL:** 30 seconds
- **Performance:** ~50-100ms response time
- **Reliability:** 99.9% uptime

### Developer Platform Client
- **Rate Limit:** Generous (project-based limits)
- **Cache:** Not implemented (real-time queries)
- **Performance:** ~100-200ms response time
- **Networks:** Mainnet & Testnet for both EVM and zkEVM

### AI Agent SDK
- **Rate Limit:** Based on OpenAI API limits
- **Cache:** Not applicable (conversational)
- **Performance:** 1-5 seconds (depends on LLM)
- **Cost:** OpenAI API usage charges apply

## Integration Examples

### Example 1: Real-Time Portfolio Tracker

```typescript
import { cryptocomPlatform } from '@/lib/services/CryptocomDeveloperPlatformService';
import { cryptocomExchange } from '@/lib/services/CryptocomExchangeService';

async function getPortfolioValue(address: string) {
  // Get native CRO balance
  const croBalance = await cryptocomPlatform.getNativeBalance(address);
  
  // Get CRO price
  const croPrice = await cryptocomExchange.getPrice('CRO');
  
  // Calculate value
  const totalValue = parseFloat(croBalance.balanceFormatted) * croPrice;
  
  return {
    cro: croBalance.balanceFormatted,
    croPrice,
    totalValue,
  };
}
```

### Example 2: AI-Powered Trading Assistant

```typescript
import { cryptocomAIAgent } from '@/lib/services/CryptocomAIAgentService';

async function tradingAssistant(userQuery: string) {
  // Process user's natural language request
  const result = await cryptocomAIAgent.query(userQuery);
  
  // Parse intent
  const intent = await cryptocomAIAgent.parseIntent(userQuery);
  
  if (intent.intent === 'swap') {
    // Execute swap
    return await cryptocomAIAgent.swapTokens(
      intent.entities.fromToken,
      intent.entities.toToken,
      intent.entities.amount
    );
  }
  
  return result;
}

// Usage
const result = await tradingAssistant("Swap 100 CRO to USDC");
```

### Example 3: Multi-Source Price Aggregation

```typescript
import { realMarketDataService } from '@/lib/services/RealMarketDataService';

async function getReliablePrice(symbol: string) {
  try {
    const price = await realMarketDataService.getTokenPrice(symbol);
    
    console.log(`✅ Got ${symbol} price from ${price.source}`);
    
    // Check data freshness
    const age = Date.now() - price.timestamp;
    if (age > 60000) {
      console.warn(`⚠️ Price data is ${Math.round(age / 1000)}s old`);
    }
    
    return price;
  } catch (error) {
    console.error('❌ All price sources failed:', error);
    throw error;
  }
}
```

## Troubleshooting

### Issue: "AI Agent service not initialized"
**Solution:** Call `initialize()` before using:
```typescript
await cryptocomAIAgent.initialize({
  openaiApiKey: process.env.OPENAI_API_KEY,
  dashboardApiKey: process.env.DASHBOARD_API_KEY,
});
```

### Issue: "Rate limit exceeded" from Exchange API
**Solution:** The service automatically falls back to MCP Server. If you're making many requests:
```typescript
// Use batch fetching instead of individual calls
const prices = await cryptocomExchange.getBatchPrices(['BTC', 'ETH', 'CRO']);
```

### Issue: "Invalid API key" for Developer Platform
**Solution:** Ensure you're using the correct key format:
1. Get key from https://developers.zkevm.cronos.org/user/apikeys
2. Add both `DASHBOARD_API_KEY` and `CRYPTOCOM_DEVELOPER_API_KEY` to `.env.local`
3. Restart your development server

### Issue: Market prices showing "from mock"
**Solution:** All real sources failed. Check:
1. Internet connectivity
2. API keys are valid
3. No rate limits exceeded
4. Services are operational (check status pages)

## Testing

### Test Market Data Service
```typescript
import { realMarketDataService } from '@/lib/services/RealMarketDataService';

async function testMarketData() {
  const symbols = ['BTC', 'ETH', 'CRO', 'USDC'];
  
  for (const symbol of symbols) {
    const price = await realMarketDataService.getTokenPrice(symbol);
    console.log(`${symbol}: $${price.price} (${price.source})`);
  }
}

testMarketData();
```

### Test AI Agent
```typescript
import { cryptocomAIAgent } from '@/lib/services/CryptocomAIAgentService';

async function testAIAgent() {
  await cryptocomAIAgent.initialize();
  
  const result = await cryptocomAIAgent.query("What is the latest block on Cronos?");
  console.log('AI Response:', result.response);
  
  const isHealthy = await cryptocomAIAgent.healthCheck();
  console.log('Health:', isHealthy ? '✅' : '❌');
}

testAIAgent();
```

## Best Practices

### 1. Always Handle Errors
```typescript
try {
  const price = await cryptocomExchange.getPrice('BTC');
} catch (error) {
  console.error('Failed to get price:', error);
  // Use fallback or cached data
}
```

### 2. Use Batch Operations
```typescript
// ❌ Bad: Multiple individual calls
const btc = await cryptocomExchange.getPrice('BTC');
const eth = await cryptocomExchange.getPrice('ETH');
const cro = await cryptocomExchange.getPrice('CRO');

// ✅ Good: Single batch call
const prices = await cryptocomExchange.getBatchPrices(['BTC', 'ETH', 'CRO']);
```

### 3. Initialize Services Once
```typescript
// In a React context or service singleton
useEffect(() => {
  cryptocomAIAgent.initialize({
    openaiApiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
    dashboardApiKey: process.env.NEXT_PUBLIC_DASHBOARD_API_KEY,
  });
}, []); // Only once on mount
```

### 4. Check Health Before Critical Operations
```typescript
const isHealthy = await cryptocomAIAgent.healthCheck();
if (!isHealthy) {
  console.warn('AI Agent not available, using fallback');
  // Use alternative method
}
```

## API Reference

### Exchange API Service

#### `getPrice(symbol: string): Promise<number>`
Get current price for a symbol.

#### `getMarketData(symbol: string): Promise<MarketPrice>`
Get full market data including 24h statistics.

#### `getBatchPrices(symbols: string[]): Promise<Record<string, number>>`
Fetch multiple prices in parallel.

#### `getAllTickers(): Promise<Ticker[]>`
Get all available trading pairs.

#### `healthCheck(): Promise<boolean>`
Check if service is operational.

### Developer Platform Service

#### `initialize(config: DeveloperPlatformConfig): Promise<void>`
Initialize the service with API key and network.

#### `getNativeBalance(address: string): Promise<OnChainBalance>`
Get native CRO balance.

#### `getTokenBalance(address: string, tokenAddress: string): Promise<TokenBalance>`
Get ERC-20 token balance.

#### `getTransaction(txHash: string): Promise<TransactionDetail>`
Get transaction details and status.

#### `getAddressTransactions(address: string, limit?: number): Promise<Transaction[]>`
Get transaction history for an address.

#### `getLatestBlock(): Promise<BlockInfo>`
Get information about the latest block.

#### `switchNetwork(network: string): Promise<void>`
Change the active network.

### AI Agent Service

#### `initialize(config?: AgentConfig): Promise<void>`
Initialize the AI Agent with LLM and blockchain config.

#### `query(userQuery: string, conversationContext?: any[]): Promise<AgentQueryResult>`
Process a natural language query.

#### `sendTokens(recipientAddress: string, amount: number, symbol?: string): Promise<BlockchainOperation>`
Send tokens using natural language interface.

#### `analyzePortfolio(address: string): Promise<AgentQueryResult>`
Get AI-powered portfolio analysis.

#### `assessRisk(address: string, action: string): Promise<AgentQueryResult>`
Assess risk for a potential action.

#### `healthCheck(): Promise<boolean>`
Check if AI Agent is operational.

## Additional Resources

- [Crypto.com Developers Portal](https://developers.crypto.com/)
- [Cronos zkEVM Documentation](https://developers.zkevm.cronos.org/)
- [AI Agent SDK GitHub](https://github.com/crypto-com/developer-platform-sdk-examples)
- [Market Data MCP Server](https://mcp.crypto.com/docs)
- [Cronos EVM Explorer](https://explorer.cronos.org/)
- [Cronos zkEVM Explorer](https://explorer.zkevm.cronos.org/)

## Support

For issues or questions:
1. Check this documentation first
2. Review the code examples in `lib/services/`
3. Check Crypto.com developer documentation
4. Open an issue on the project repository
