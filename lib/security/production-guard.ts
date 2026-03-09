/**
 * Production Safety Guards
 * 
 * CRITICAL: This module provides safety checks for production deployment.
 * These guards prevent mock data, stale prices, and invalid calculations
 * from being used when real money is at stake.
 * 
 * Usage:
 *   import { ProductionGuard, validateFinancialAmount, requireLivePrice } from '@/lib/security/production-guard';
 */

import { logger } from '@/lib/utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const IS_TEST = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
export const IS_DEVELOPMENT = !IS_PRODUCTION && !IS_TEST;

// Explicit production override - set FORCE_PRODUCTION_SAFETY=true in staging to enforce production checks
export const ENFORCE_PRODUCTION_SAFETY = IS_PRODUCTION || process.env.FORCE_PRODUCTION_SAFETY === 'true';

// ═══════════════════════════════════════════════════════════════════════════
// PRICE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

// Maximum age for price data in production (5 minutes = 300,000ms)
const MAX_PRICE_AGE_MS = 300000;

// Reasonable price bounds for major assets (to catch obviously wrong data)
const PRICE_BOUNDS: Record<string, { min: number; max: number }> = {
  BTC: { min: 1000, max: 1000000 },      // Bitcoin: $1K-$1M
  ETH: { min: 100, max: 100000 },        // Ethereum: $100-$100K
  CRO: { min: 0.001, max: 10 },          // Cronos: $0.001-$10
  SUI: { min: 0.01, max: 1000 },         // Sui: $0.01-$1K
  USDC: { min: 0.95, max: 1.05 },        // USDC: $0.95-$1.05 (stablecoin)
  USDT: { min: 0.95, max: 1.05 },        // USDT: $0.95-$1.05
};

export interface ValidatedPrice {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
  isStale: boolean;
  age: number;
}

/**
 * Validate a price is reasonable and not stale
 * 
 * @throws Error in production if price is invalid or too stale
 * @returns ValidatedPrice with metadata
 */
export function requireLivePrice(
  symbol: string,
  price: number | null | undefined,
  timestamp: number,
  source: string
): ValidatedPrice {
  const now = Date.now();
  const age = now - timestamp;
  const normalizedSymbol = symbol.toUpperCase().replace(/^W/, ''); // Handle WBTC, WETH etc.
  
  // Check for null/undefined/NaN
  if (price === null || price === undefined || !Number.isFinite(price)) {
    const error = `[ProductionGuard] CRITICAL: Invalid price for ${symbol}: ${price}`;
    logger.error(error, { symbol, price, source });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Price unavailable for ${symbol}. Operation halted for safety.`);
    }
    
    // In dev mode, log warning but don't throw
    logger.warn(`[ProductionGuard] Using invalid price in dev mode for ${symbol}`);
    return { symbol, price: 0, timestamp, source, isStale: true, age };
  }
  
  // Check price is positive
  if (price <= 0) {
    const error = `[ProductionGuard] CRITICAL: Non-positive price for ${symbol}: ${price}`;
    logger.error(error, { symbol, price, source });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid price (${price}) for ${symbol}. Operation halted.`);
    }
  }
  
  // Check price is within reasonable bounds
  const bounds = PRICE_BOUNDS[normalizedSymbol];
  if (bounds && (price < bounds.min || price > bounds.max)) {
    const error = `[ProductionGuard] CRITICAL: Price out of bounds for ${symbol}: $${price} (expected $${bounds.min}-$${bounds.max})`;
    logger.error(error, { symbol, price, bounds, source });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Suspicious price for ${symbol}: $${price}. Verify market data source.`);
    }
  }
  
  // Check price freshness
  const isStale = age > MAX_PRICE_AGE_MS;
  if (isStale) {
    const ageMinutes = Math.round(age / 60000);
    const warning = `[ProductionGuard] Stale price for ${symbol}: ${ageMinutes} minutes old`;
    logger.warn(warning, { symbol, price, age, source });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Price for ${symbol} is ${ageMinutes} minutes stale. Refusing to proceed with stale data.`);
    }
  }
  
  return { symbol, price, timestamp, source, isStale, age };
}

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL AMOUNT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

// Maximum values to prevent overflow/manipulation
const MAX_USD_AMOUNT = 1_000_000_000_000; // $1 trillion max
const MAX_SHARES = 1_000_000_000_000;     // 1 trillion shares max
const MAX_LEVERAGE = 125;                  // 125x max leverage (per exchange standards)
const MIN_DEPOSIT_USD = 0.01;              // $0.01 minimum
const MAX_PERCENTAGE = 100;                // 100% max

export interface ValidatedAmount {
  value: number;
  original: unknown;
  wasDefaulted: boolean;
}

/**
 * Validate a financial amount (USD value)
 * 
 * @throws Error if amount is invalid and we're in production
 * @returns Validated amount
 */
export function validateFinancialAmount(
  amount: unknown,
  fieldName: string,
  options: {
    allowZero?: boolean;
    minValue?: number;
    maxValue?: number;
    defaultValue?: never; // NEVER allow defaults for financial amounts
  } = {}
): number {
  const { allowZero = false, minValue = MIN_DEPOSIT_USD, maxValue = MAX_USD_AMOUNT } = options;
  
  // Parse the value
  const parsed = typeof amount === 'number' ? amount : parseFloat(String(amount));
  
  // Check for invalid values
  if (amount === null || amount === undefined || !Number.isFinite(parsed)) {
    const error = `[ProductionGuard] CRITICAL: Invalid ${fieldName}: ${amount}`;
    logger.error(error, { fieldName, amount, parsed });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: value is required and must be a valid number`);
    }
    
    // In dev, return 0 with warning (but this should NEVER happen in prod)
    logger.warn(`[ProductionGuard] Defaulting invalid ${fieldName} to 0 in dev mode`);
    return 0;
  }
  
  // Check for non-positive (unless zero allowed)
  if (parsed < 0 || (!allowZero && parsed === 0)) {
    const error = `[ProductionGuard] Invalid ${fieldName}: ${parsed} (must be ${allowZero ? 'non-negative' : 'positive'})`;
    logger.error(error, { fieldName, parsed });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: ${parsed}. Value must be ${allowZero ? 'non-negative' : 'positive'}.`);
    }
  }
  
  // Check bounds
  if (parsed < minValue) {
    const error = `[ProductionGuard] ${fieldName} too small: ${parsed} (min: ${minValue})`;
    logger.error(error, { fieldName, parsed, minValue });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`${fieldName} (${parsed}) is below minimum (${minValue})`);
    }
  }
  
  if (parsed > maxValue) {
    const error = `[ProductionGuard] ${fieldName} too large: ${parsed} (max: ${maxValue})`;
    logger.error(error, { fieldName, parsed, maxValue });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`${fieldName} (${parsed}) exceeds maximum (${maxValue})`);
    }
  }
  
  return parsed;
}

/**
 * Validate share amount
 */
export function validateShares(shares: unknown, fieldName: string = 'shares'): number {
  return validateFinancialAmount(shares, fieldName, {
    minValue: 0.000001, // Minimum detectable share amount
    maxValue: MAX_SHARES,
  });
}

/**
 * Validate percentage (0-100)
 */
export function validatePercentage(percentage: unknown, fieldName: string = 'percentage'): number {
  return validateFinancialAmount(percentage, fieldName, {
    allowZero: true,
    minValue: 0,
    maxValue: MAX_PERCENTAGE,
  });
}

/**
 * Validate leverage
 */
export function validateLeverage(leverage: unknown, fieldName: string = 'leverage'): number {
  const parsed = validateFinancialAmount(leverage, fieldName, {
    minValue: 1,
    maxValue: MAX_LEVERAGE,
  });
  
  // Leverage must be a whole number or common fractions (1, 1.5, 2, 2.5, etc.)
  const validLeverageSteps = [1, 1.5, 2, 2.5, 3, 5, 10, 20, 25, 50, 75, 100, 125];
  if (!validLeverageSteps.includes(parsed) && !Number.isInteger(parsed)) {
    logger.warn(`[ProductionGuard] Unusual leverage value: ${parsed}`, { fieldName, parsed });
  }
  
  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SUI_ADDRESS_REGEX = /^0x[a-fA-F0-9]{64}$/;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

/**
 * Validate Ethereum/Cronos address
 */
export function validateEvmAddress(address: unknown, fieldName: string = 'address'): string {
  if (typeof address !== 'string') {
    const error = `[ProductionGuard] Invalid ${fieldName}: not a string`;
    logger.error(error, { fieldName, address });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: must be a string`);
    }
    return '';
  }
  
  if (!EVM_ADDRESS_REGEX.test(address)) {
    const error = `[ProductionGuard] Invalid ${fieldName}: not a valid EVM address`;
    logger.error(error, { fieldName, address });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: must be a valid Ethereum address (0x...)`);
    }
  }
  
  return address.toLowerCase();
}

/**
 * Validate transaction hash
 */
export function validateTxHash(hash: unknown, fieldName: string = 'txHash'): string {
  if (typeof hash !== 'string') {
    const error = `[ProductionGuard] Invalid ${fieldName}: not a string`;
    logger.error(error, { fieldName, hash });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: must be a string`);
    }
    return '';
  }
  
  if (!TX_HASH_REGEX.test(hash)) {
    const error = `[ProductionGuard] Invalid ${fieldName}: not a valid transaction hash`;
    logger.error(error, { fieldName, hash });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Invalid ${fieldName}: must be a valid 32-byte hex hash`);
    }
  }
  
  return hash.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// ANOMALY DETECTION / CIRCUIT BREAKERS
// ═══════════════════════════════════════════════════════════════════════════

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  openedAt?: number;
}

const circuitBreakers: Map<string, CircuitBreakerState> = new Map();

const CIRCUIT_BREAKER_THRESHOLD = 5;        // Open after 5 failures
const CIRCUIT_BREAKER_RESET_MS = 60000;     // Reset after 1 minute of no failures
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000;  // Stay open for 30 seconds before retry

/**
 * Check if a circuit breaker is open (service should not be called)
 */
export function isCircuitBreakerOpen(serviceName: string): boolean {
  const state = circuitBreakers.get(serviceName);
  if (!state) return false;
  
  // Check if cooldown has passed
  if (state.isOpen && state.openedAt && Date.now() - state.openedAt > CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Allow one retry (half-open state)
    state.isOpen = false;
    logger.info(`[CircuitBreaker] ${serviceName} entering half-open state`);
    return false;
  }
  
  return state.isOpen;
}

/**
 * Record a failure for circuit breaker
 */
export function recordCircuitBreakerFailure(serviceName: string): void {
  const now = Date.now();
  let state = circuitBreakers.get(serviceName);
  
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false };
    circuitBreakers.set(serviceName, state);
  }
  
  // Reset counter if enough time has passed
  if (now - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    state.failures = 0;
  }
  
  state.failures++;
  state.lastFailure = now;
  
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD && !state.isOpen) {
    state.isOpen = true;
    state.openedAt = now;
    logger.error(`[CircuitBreaker] OPENED for ${serviceName} after ${state.failures} failures`, {
      serviceName,
      failures: state.failures,
    });
  }
}

/**
 * Record a success (resets circuit breaker)
 */
export function recordCircuitBreakerSuccess(serviceName: string): void {
  const state = circuitBreakers.get(serviceName);
  if (state) {
    state.failures = 0;
    state.isOpen = false;
    state.openedAt = undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditLogEntry {
  timestamp: number;
  operation: string;
  walletAddress?: string;
  amount?: number;
  asset?: string;
  txHash?: string;
  result: 'success' | 'failure' | 'rejected';
  reason?: string;
  metadata?: Record<string, unknown>;
}

const auditLogs: AuditLogEntry[] = [];
const MAX_AUDIT_LOG_SIZE = 10000;

/**
 * Log a financial operation for audit trail
 */
export function auditLog(entry: AuditLogEntry): void {
  // Add to in-memory buffer
  auditLogs.push(entry);
  
  // Trim if too large
  if (auditLogs.length > MAX_AUDIT_LOG_SIZE) {
    auditLogs.splice(0, auditLogs.length - MAX_AUDIT_LOG_SIZE);
  }
  
  // Also log to standard logger with AUDIT prefix
  const level = entry.result === 'failure' || entry.result === 'rejected' ? 'error' : 'info';
  logger[level](`[AUDIT] ${entry.operation}`, {
    ...entry,
    timestamp: new Date(entry.timestamp).toISOString(),
  });
}

/**
 * Get recent audit logs (for debugging/admin)
 */
export function getRecentAuditLogs(count: number = 100): AuditLogEntry[] {
  return auditLogs.slice(-count);
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION ASSERTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert a condition is true - throws in production, warns in dev
 */
export function productionAssert(condition: boolean, message: string, context?: Record<string, unknown>): void {
  if (!condition) {
    const error = `[ProductionGuard] Assertion failed: ${message}`;
    logger.error(error, context);
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(message);
    }
  }
}

/**
 * Require that we're not using test/mock data in production
 */
export function requireNotMock(source: string, context?: Record<string, unknown>): void {
  const mockIndicators = ['mock', 'test', 'fake', 'dummy', 'sample', 'simulated'];
  const sourceLower = source.toLowerCase();
  
  for (const indicator of mockIndicators) {
    if (sourceLower.includes(indicator)) {
      const error = `[ProductionGuard] CRITICAL: Mock data source detected: ${source}`;
      logger.error(error, context);
      
      if (ENFORCE_PRODUCTION_SAFETY) {
        throw new Error(`Mock/test data source "${source}" is not allowed in production`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

// Production network chain IDs
const PRODUCTION_CHAIN_IDS = {
  CRONOS_MAINNET: 25,
  ETHEREUM_MAINNET: 1,
  SUI_MAINNET: 'mainnet',
};

// Testnet chain IDs (should NOT be used in production)
const TESTNET_CHAIN_IDS = {
  CRONOS_TESTNET: 338,
  SEPOLIA: 11155111,
  OASIS_SAPPHIRE_TESTNET: 23295,
  OASIS_EMERALD_TESTNET: 42261,
};

/**
 * Validate network is production (not testnet)
 */
export function requireProductionNetwork(chainId: number | string, serviceName: string): void {
  const testnetValues = Object.values(TESTNET_CHAIN_IDS);
  
  if (testnetValues.includes(chainId as number)) {
    const warning = `[ProductionGuard] Service ${serviceName} is using testnet (chainId: ${chainId})`;
    logger.warn(warning);
    
    // Only enforce in explicit production mode (not just ENFORCE_PRODUCTION_SAFETY)
    // since staging might legitimately use testnet
    if (IS_PRODUCTION && process.env.REQUIRE_MAINNET === 'true') {
      throw new Error(`${serviceName} must use mainnet in production. Current chainId: ${chainId}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND TRANSACTION BLOCKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CRITICAL: Block any backend transaction that would move user funds
 * 
 * This function MUST be called before ANY code that would:
 * 1. Use a private key to sign transactions affecting user funds
 * 2. Call sendTransaction() or similar for user fund operations
 * 3. Execute swaps, transfers, or withdrawals on behalf of users
 * 
 * The ONLY exceptions are:
 * - Relayer paying GAS for user-signed meta-transactions (X402 pattern)
 * - Admin deployment scripts (not user funds)
 * - Oracle price updates (not user funds)
 * 
 * @throws ALWAYS throws in production - backend should NEVER execute user fund txs
 */
export function blockBackendTransaction(
  operation: string,
  context: { walletAddress?: string; amount?: number; asset?: string } = {}
): never {
  const error = `[ProductionGuard] BLOCKED: Backend attempted to execute user fund transaction`;
  const details = {
    operation,
    ...context,
    timestamp: new Date().toISOString(),
    stack: new Error().stack,
  };
  
  logger.error(error, details);
  
  // ALWAYS throw - there is NO legitimate reason for backend to move user funds
  throw new Error(
    `SECURITY VIOLATION: Backend cannot execute "${operation}" on user funds. ` +
    `All transactions MUST be signed by user's wallet.`
  );
}

/**
 * Validate operation is user-initiated (has wallet signature proof)
 * 
 * For operations that REQUIRE user wallet signature, call this to verify
 * the request contains proof of user initiation.
 * 
 * @param signatureOrProof - EIP-712 signature, txHash, or wallet-signed proof
 * @param operation - Name of the operation for logging
 */
export function requireUserInitiated(
  signatureOrProof: string | null | undefined,
  operation: string
): void {
  if (!signatureOrProof || typeof signatureOrProof !== 'string' || signatureOrProof.length < 10) {
    const error = `[ProductionGuard] Operation "${operation}" requires user wallet signature`;
    logger.error(error, { operation, proofProvided: !!signatureOrProof });
    
    if (ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(
        `Operation "${operation}" requires user signature. ` +
        `This action must be initiated from user's wallet.`
      );
    }
  }
}

/**
 * Whitelist of operations that MAY use backend signing (non-user-fund operations)
 */
const ALLOWED_BACKEND_OPERATIONS = [
  'relayer_gas_payment',      // Paying gas for user-signed meta-tx
  'oracle_price_update',      // Updating price feeds
  'deploy_contract',          // Contract deployment
  'admin_config_update',      // Updating protocol parameters
];

/**
 * Check if operation is in the allowed backend operations whitelist
 */
export function isAllowedBackendOperation(operation: string): boolean {
  return ALLOWED_BACKEND_OPERATIONS.some(allowed => 
    operation.toLowerCase().includes(allowed.toLowerCase())
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ProductionGuard = {
  IS_PRODUCTION,
  IS_TEST,
  IS_DEVELOPMENT,
  ENFORCE_PRODUCTION_SAFETY,
  requireLivePrice,
  validateFinancialAmount,
  validateShares,
  validatePercentage,
  validateLeverage,
  validateEvmAddress,
  validateTxHash,
  isCircuitBreakerOpen,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  auditLog,
  getRecentAuditLogs,
  productionAssert,
  requireNotMock,
  requireProductionNetwork,
  // Backend transaction blocking
  blockBackendTransaction,
  requireUserInitiated,
  isAllowedBackendOperation,
};

export default ProductionGuard;
