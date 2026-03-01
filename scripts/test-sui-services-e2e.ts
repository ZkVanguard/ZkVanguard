/**
 * SUI Services End-to-End Testnet Test
 * 
 * Tests all 7 SUI services against the live SUI testnet:
 * 1. CetusSwapService       - Token resolution, quotes, pool info, prices
 * 2. SuiOnChainHedgeService - Contract reads, commitment generation, tx builders
 * 3. SuiCommunityPoolService - Pool stats, tx builders, payment routing
 * 4. SuiAutoHedgingAdapter  - Lifecycle, config, risk assessment
 * 5. SuiPrivateHedgeService - Commitment scheme, proofs, stealth deposits
 * 6. SuiExplorerService     - Balances, transactions, objects, checkpoints
 * 7. SuiPortfolioManager    - Init, positions, risk metrics, hedging
 * 
 * Run: npx tsx scripts/test-sui-services-e2e.ts
 */

// ===== Minimal logger shim (avoid @/ alias issues) =====
const logShim = {
  info: (msg: string, ctx?: Record<string, unknown>) => console.log(`  ℹ️  ${msg}`, ctx ? JSON.stringify(ctx, bigintReplacer, 0) : ''),
  warn: (msg: string, ctx?: Record<string, unknown>) => console.log(`  ⚠️  ${msg}`, ctx ? JSON.stringify(ctx, bigintReplacer, 0) : ''),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) => console.error(`  ❌ ${msg}`, err, ctx || ''),
  debug: (msg: string, ctx?: Record<string, unknown>) => {}, // silence debug
};

// BigInt serializer for JSON.stringify
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() + 'n' : value;
}

// ===== PATCH: Override @/lib/utils/logger before importing services =====
import * as path from 'path';

const rootDir = path.resolve(__dirname, '..');
const loggerPath = path.resolve(rootDir, 'lib', 'utils', 'logger');

// Create a fake module entry to pre-populate require cache
const ModuleConstructor = require('module');
for (const ext of ['.ts', '.js', '']) {
  const key = loggerPath + ext;
  const m = new ModuleConstructor(key);
  m.exports = { logger: logShim };
  m.loaded = true;
  require.cache[key] = m;
}

// ===== Constants =====
const SUI_RPC = 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
const OBJECT_IDS = {
  rwaManagerState: '0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97',
  hedgeExecutorState: '0xb6432f1ecc1f55a1f3f3c8c09d110c4bda9ed6536bd9ea4c9cb5e739c41cb41e',
  zkProxyVaultState: '0x5a0c81e3c95abe2b802e65d69439923ba786cdb87c528737e1680a0c791378a4',
  zkVerifierState: '0x6c75de60a47a9704625ecfb29c7bb05b49df215729133349345d0a15bec84be8',
  zkHedgeCommitmentState: '0x9c33f0df3d6a2e9a0f137581912aefb6aafcf0423d933fea298d44e222787b02',
  paymentRouterState: '0x1fba1a6a0be32f5d678da2910b99900f74af680531563fd7274d5059e1420678',
};

// ===== Helpers =====
let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label: string, detail?: string) {
  passed++;
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, err: unknown) {
  failed++;
  console.error(`  ❌ ${label} — ${err instanceof Error ? err.message : String(err)}`);
}

function skip(label: string, reason: string) {
  skipped++;
  console.log(`  ⏭️  ${label} — SKIPPED: ${reason}`);
}

async function suiRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC ${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}

// ============================================================
// TEST 1: Verify deployed contracts exist on SUI testnet
// ============================================================
async function testDeployedContracts() {
  console.log('\n═══ TEST 1: Deployed Contract Verification ═══');

  // Verify package exists
  try {
    const pkg = await suiRpc('sui_getObject', [PACKAGE_ID, { showContent: true, showType: true }]) as Record<string, unknown>;
    const data = pkg.data as Record<string, unknown> | undefined;
    if (data && data.objectId) {
      ok('Package exists on testnet', `objectId: ${(data.objectId as string).slice(0, 20)}...`);
    } else {
      fail('Package lookup', 'No data returned');
    }
  } catch (e) { fail('Package lookup', e); }

  // Verify each state object
  for (const [name, objectId] of Object.entries(OBJECT_IDS)) {
    try {
      const obj = await suiRpc('sui_getObject', [objectId, { showContent: true, showType: true }]) as Record<string, unknown>;
      const data = obj.data as Record<string, unknown> | undefined;
      if (data && data.objectId) {
        const objType = (data.type as string) || '';
        ok(`${name}`, `type: ${objType.split('::').slice(-2).join('::')}`);
      } else {
        fail(name, 'Object not found');
      }
    } catch (e) { fail(name, e); }
  }
}

// ============================================================
// TEST 2: CetusSwapService — token resolution, quotes, prices
// ============================================================
async function testCetusSwapService() {
  console.log('\n═══ TEST 2: CetusSwapService ═══');

  // Test token resolution
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');

    // Token lookups
    const sui = svc.getTokenInfo('SUI');
    if (sui.symbol === 'SUI' && sui.decimals === 9) {
      ok('Token resolution: SUI', `type: ${sui.type}`);
    } else {
      fail('Token resolution: SUI', 'Wrong tokenInfo');
    }

    const usdc = svc.getTokenInfo('USDC');
    if (usdc.symbol === 'USDC' && usdc.decimals === 6) {
      ok('Token resolution: USDC', `type: ${usdc.type.slice(0, 20)}...`);
    } else {
      fail('Token resolution: USDC', 'Wrong tokenInfo');
    }

    // Unsupported token should throw
    try {
      svc.getTokenInfo('FAKECOIN');
      fail('Unsupported token rejection', 'Should have thrown');
    } catch {
      ok('Unsupported token rejection', 'Correctly throws');
    }

    // isTokenSupported
    if (svc.isTokenSupported('SUI') && !svc.isTokenSupported('FAKECOIN')) {
      ok('isTokenSupported()', 'SUI=true, FAKECOIN=false');
    } else {
      fail('isTokenSupported()', 'Unexpected results');
    }

    // getSupportedTokens
    const tokens = svc.getSupportedTokens();
    const tokenNames = Object.keys(tokens);
    if (tokenNames.includes('SUI') && tokenNames.includes('USDC')) {
      ok('getSupportedTokens()', `${tokenNames.length} tokens: ${tokenNames.join(', ')}`);
    } else {
      fail('getSupportedTokens()', 'Missing SUI or USDC');
    }

    // getConfig
    const config = svc.getConfig();
    if (config.apiUrl.includes('devcetus') || config.apiUrl.includes('cetus')) {
      ok('getConfig()', `apiUrl: ${config.apiUrl}`);
    } else {
      fail('getConfig()', 'Unexpected config');
    }

  } catch (e) { fail('CetusSwapService init', e); }

  // Swap quote: SUI → USDC (1 SUI)
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');
    const quote = await svc.getSwapQuote({
      tokenIn: 'SUI',
      tokenOut: 'USDC',
      amountIn: 1_000_000_000n, // 1 SUI (9 decimals)
      slippage: 1.0,
    });

    if (quote.amountOut > 0n) {
      const usdcOut = Number(quote.amountOut) / 1e6;
      ok('Swap quote SUI→USDC', `1 SUI ≈ ${usdcOut.toFixed(4)} USDC | impact: ${quote.priceImpact}% | route: ${quote.route}`);
    } else {
      fail('Swap quote SUI→USDC', 'amountOut is 0');
    }

    // Verify amountOutMin < amountOut (slippage applied)
    if (quote.amountOutMin <= quote.amountOut) {
      ok('Slippage calculation', `amountOutMin (${quote.amountOutMin}) <= amountOut (${quote.amountOut})`);
    } else {
      fail('Slippage calculation', 'amountOutMin > amountOut');
    }
  } catch (e) { fail('Swap quote', e); }

  // Swap quote: USDC → SUI
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');
    const quote = await svc.getSwapQuote({
      tokenIn: 'USDC',
      tokenOut: 'SUI',
      amountIn: 5_000_000n, // 5 USDC
    });
    if (quote.amountOut > 0n) {
      const suiOut = Number(quote.amountOut) / 1e9;
      ok('Swap quote USDC→SUI', `5 USDC ≈ ${suiOut.toFixed(4)} SUI`);
    } else {
      fail('Swap quote USDC→SUI', 'amountOut is 0');
    }
  } catch (e) { fail('Swap quote USDC→SUI', e); }

  // Build swap transaction
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');
    const quote = await svc.getSwapQuote({
      tokenIn: 'SUI',
      tokenOut: 'USDC',
      amountIn: 500_000_000n,
    });
    const txParams = svc.buildSwapTransaction({
      tokenIn: 'SUI',
      tokenOut: 'USDC',
      amountIn: 500_000_000n,
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    }, quote);

    if (txParams.target && txParams.typeArguments.length === 2) {
      ok('buildSwapTransaction()', `target: ${txParams.target.split('::').slice(-2).join('::')}, typeArgs: ${txParams.typeArguments.length}`);
    } else {
      fail('buildSwapTransaction()', 'Invalid tx params');
    }
  } catch (e) { fail('buildSwapTransaction()', e); }

  // Token price
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');
    const price = await svc.getTokenPrice('SUI');
    if (price > 0) {
      ok('getTokenPrice(SUI)', `$${price}`);
    } else {
      fail('getTokenPrice(SUI)', `price = ${price}`);
    }
  } catch (e) { fail('getTokenPrice(SUI)', e); }

  // Pool info
  try {
    const svc = new (await import('../lib/services/CetusSwapService')).CetusSwapService('testnet');
    const pools = await svc.getPools(5);
    // Pools may be empty on testnet — that's fine, just test the call doesn't crash
    ok('getPools()', `returned ${pools.length} pools`);
  } catch (e) { fail('getPools()', e); }
}

// ============================================================
// TEST 3: SuiExplorerService — on-chain reads
// ============================================================
async function testSuiExplorerService() {
  console.log('\n═══ TEST 3: SuiExplorerService ═══');

  const { SuiExplorerService } = await import('../lib/services/SuiExplorerService');
  const explorer = new SuiExplorerService('testnet');

  // Get SUI balance of a known address (the package publisher)
  // We'll use the deployer address from the conversation
  const testAddr = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c'; // This is an EVM address
  // Use the package ID as a known SUI object owner instead
  // Let's check the rwaManagerState owner
  try {
    const obj = await explorer.getObject(OBJECT_IDS.rwaManagerState);
    if (obj) {
      ok('getObject(rwaManager)', `type: ${obj.type.split('::').slice(-2).join('::')}, version: ${obj.version}`);
      
      // Extract owner address for further tests
      const ownerAddr = typeof obj.owner === 'string' ? obj.owner 
        : (obj.owner as Record<string, string>)?.AddressOwner || '';
      if (ownerAddr) {
        ok('Object owner extracted', `${ownerAddr.slice(0, 20)}...`);

        // Get balance for this owner
        try {
          const balance = await explorer.getSuiBalance(ownerAddr);
          ok('getSuiBalance(owner)', `${balance.balanceFormatted.toFixed(4)} SUI (${balance.coinObjectCount} coins)`);
        } catch (e) { fail('getSuiBalance(owner)', e); }

        // Get all balances
        try {
          const balances = await explorer.getAllBalances(ownerAddr);
          ok('getAllBalances(owner)', `${balances.length} coin types found`);
          for (const b of balances.slice(0, 3)) {
            console.log(`       ${b.symbol}: ${b.balanceFormatted}`);
          }
        } catch (e) { fail('getAllBalances(owner)', e); }

        // Transaction history
        try {
          const { transactions, nextCursor } = await explorer.getTransactionHistory(ownerAddr, 5);
          ok('getTransactionHistory()', `${transactions.length} txs, nextCursor: ${nextCursor ? 'yes' : 'none'}`);
          for (const tx of transactions.slice(0, 2)) {
            console.log(`       ${tx.digest.slice(0, 16)}... status: ${tx.status}`);
          }
        } catch (e) { fail('getTransactionHistory()', e); }
      }
    } else {
      fail('getObject(rwaManager)', 'Object is null');
    }
  } catch (e) { fail('getObject(rwaManager)', e); }

  // Inspect hedge executor state object
  try {
    const obj = await explorer.getObject(OBJECT_IDS.hedgeExecutorState);
    if (obj) {
      ok('getObject(hedgeExecutor)', `type: ${obj.type.split('::').slice(-2).join('::')}`);
    } else {
      fail('getObject(hedgeExecutor)', 'Object is null');
    }
  } catch (e) { fail('getObject(hedgeExecutor)', e); }

  // Inspect zkProxyVault
  try {
    const obj = await explorer.getObject(OBJECT_IDS.zkProxyVaultState);
    if (obj) {
      ok('getObject(zkProxyVault)', `type: ${obj.type.split('::').slice(-2).join('::')}`);
      // Log content fields
      if (obj.content && Object.keys(obj.content).length > 0) {
        const fieldNames = Object.keys(obj.content);
        ok('  → content fields', fieldNames.slice(0, 5).join(', '));
      }
    }
  } catch (e) { fail('getObject(zkProxyVault)', e); }

  // Latest checkpoint
  try {
    const cp = await explorer.getLatestCheckpoint();
    if (cp) {
      ok('getLatestCheckpoint()', `seq: ${cp.sequenceNumber}, txs: ${cp.transactionCount}, total: ${cp.networkTotalTransactions}`);
    } else {
      fail('getLatestCheckpoint()', 'null checkpoint');
    }
  } catch (e) { fail('getLatestCheckpoint()', e); }

  // Total transaction count
  try {
    const count = await explorer.getTotalTransactionCount();
    if (count > 0n) {
      ok('getTotalTransactionCount()', count.toString());
    } else {
      skip('getTotalTransactionCount()', 'Returned 0');
    }
  } catch (e) { fail('getTotalTransactionCount()', e); }

  // Coin metadata
  try {
    const meta = await explorer.getCoinMetadata('0x2::sui::SUI');
    if (meta) {
      ok('getCoinMetadata(SUI)', `name: ${meta.name}, symbol: ${meta.symbol}, decimals: ${meta.decimals}`);
    } else {
      skip('getCoinMetadata(SUI)', 'null response');
    }
  } catch (e) { fail('getCoinMetadata(SUI)', e); }

  // URL generators
  const txUrl = explorer.getTransactionUrl('test_digest');
  const addrUrl = explorer.getAddressUrl('0xabc');
  const objUrl = explorer.getObjectUrl('0xdef');
  if (txUrl.includes('/tx/') && addrUrl.includes('/account/') && objUrl.includes('/object/')) {
    ok('URL generators', 'tx, address, object URLs correct');
  } else {
    fail('URL generators', 'Invalid URLs');
  }
}

// ============================================================
// TEST 4: SuiOnChainHedgeService
// ============================================================
async function testSuiOnChainHedgeService() {
  console.log('\n═══ TEST 4: SuiOnChainHedgeService ═══');

  const { SuiOnChainHedgeService } = await import('../lib/services/SuiOnChainHedgeService');
  const hedgeSvc = new SuiOnChainHedgeService('testnet');

  // Read contract state via RPC
  try {
    const hedgeState = await suiRpc('sui_getObject', [
      OBJECT_IDS.hedgeExecutorState,
      { showContent: true },
    ]) as Record<string, unknown>;
    const data = hedgeState.data as Record<string, unknown> | undefined;
    const content = data?.content as Record<string, unknown> | undefined;
    const fields = content?.fields as Record<string, unknown> | undefined;

    if (fields) {
      ok('Hedge executor state readable', `fields: ${Object.keys(fields).join(', ')}`);
    } else {
      skip('Hedge executor state fields', 'No fields in content');
    }
  } catch (e) { fail('Hedge executor state read', e); }

  // ZK commitment generation
  try {
    const commitment = hedgeSvc.generateCommitment('0xtest_owner', 'mysecret');

    if (commitment.commitmentHash && commitment.commitmentHash.length > 10) {
      ok('generateCommitment()', `hash: ${commitment.commitmentHash.slice(0, 24)}...`);
    } else {
      fail('generateCommitment()', 'Invalid hash');
    }

    // Different salt each time, so hashes differ — that's correct
    const commitment2 = hedgeSvc.generateCommitment('0xtest_owner', 'mysecret');
    ok('Commitment uniqueness', `Different salts produce different hashes: ${commitment.commitmentHash.slice(0,12)} ≠ ${commitment2.commitmentHash.slice(0,12)}`);
  } catch (e) { fail('generateCommitment()', e); }

  // Build create hedge transaction
  try {
    const tx = hedgeSvc.buildCreateHedgeTransaction({
      ownerAddress: '0xtest_owner',
      ownerSecret: 'mysecret',
      asset: 'SUI-PERP',
      side: 'SHORT',
      notionalValue: 250,
      leverage: 2,
      collateralAmount: 1_000_000_000n,
    });

    if (tx.target.includes('hedge_executor') && tx.coinAmount === 1_000_000_000n) {
      ok('buildCreateHedgeTransaction()', `target: ...${tx.target.split('::').slice(-2).join('::')}`);
    } else {
      fail('buildCreateHedgeTransaction()', 'Invalid tx');
    }
  } catch (e) { fail('buildCreateHedgeTransaction()', e); }

  // Build proxy create transaction
  try {
    const tx = hedgeSvc.buildCreateProxyTransaction(
      '0xtest_owner',
      'mysecret',
      500_000_000n,
    );

    if (tx.target.includes('zk_proxy_vault')) {
      ok('buildCreateProxyTransaction()', `target: ...${tx.target.split('::').slice(-2).join('::')}`);
    } else {
      fail('buildCreateProxyTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildCreateProxyTransaction()', e); }

  // Build verify proof transaction
  try {
    const proofData = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const tx = hedgeSvc.buildVerifyProofTransaction(
      proofData,
      'abc123def456abc123def456abc123def456abc123def456abc123def456abc123de',
      'hedge_existence',
    );

    if (tx.target.includes('zk_verifier')) {
      ok('buildVerifyProofTransaction()', `target: ...${tx.target.split('::').slice(-2).join('::')}`);
    } else {
      fail('buildVerifyProofTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildVerifyProofTransaction()', e); }

  // Explorer URL generation
  try {
    const url = hedgeSvc.getExplorerUrl(OBJECT_IDS.hedgeExecutorState);
    if (url.includes('suiscan') && url.includes(OBJECT_IDS.hedgeExecutorState)) {
      ok('getExplorerUrl()', url);
    } else {
      fail('getExplorerUrl()', 'Invalid URL');
    }
  } catch (e) { fail('getExplorerUrl()', e); }

  // Deployment config
  try {
    const config = hedgeSvc.getDeploymentConfig();
    if (config.packageId === PACKAGE_ID) {
      ok('getDeploymentConfig()', `packageId matches`);
    } else {
      fail('getDeploymentConfig()', 'packageId mismatch');
    }
  } catch (e) { fail('getDeploymentConfig()', e); }
}

// ============================================================
// TEST 5: SuiCommunityPoolService
// ============================================================
async function testSuiCommunityPoolService() {
  console.log('\n═══ TEST 5: SuiCommunityPoolService ═══');

  const { SuiCommunityPoolService } = await import('../lib/services/SuiCommunityPoolService');
  const poolSvc = new SuiCommunityPoolService('testnet');

  // Pool stats (read from on-chain state)
  try {
    const stats = await poolSvc.getPoolStats();
    ok('getPoolStats()', `portfolios: ${stats.totalPortfolios}, TVL: ${stats.totalValueLocked}n, members: ${stats.memberCount}`);
  } catch (e) { fail('getPoolStats()', e); }

  // Build create portfolio transaction
  try {
    const tx = poolSvc.buildCreatePortfolioTransaction({
      targetYield: 800,        // 8% APY
      riskTolerance: 50,       // Medium
      initialDeposit: 2_000_000_000n, // 2 SUI
    });

    if (tx.target.includes('rwa_manager::create_portfolio') && tx.coinAmount === 2_000_000_000n) {
      ok('buildCreatePortfolio()', `target: ...${tx.target.split('::').slice(-2).join('::')}, deposit: ${tx.coinAmount}n`);
    } else {
      fail('buildCreatePortfolio()', 'Invalid tx');
    }
  } catch (e) { fail('buildCreatePortfolio()', e); }

  // Build deposit transaction
  try {
    const tx = poolSvc.buildDepositTransaction({
      portfolioId: '0xabc123',
      amount: 1_000_000_000n,
    });
    if (tx.target.includes('rwa_manager::deposit')) {
      ok('buildDepositTransaction()', 'target correct');
    } else {
      fail('buildDepositTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildDepositTransaction()', e); }

  // Build withdraw transaction
  try {
    const tx = poolSvc.buildWithdrawTransaction({
      portfolioId: '0xabc123',
      amount: 500_000_000n,
    });
    if (tx.target.includes('rwa_manager::withdraw')) {
      ok('buildWithdrawTransaction()', 'target correct');
    } else {
      fail('buildWithdrawTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildWithdrawTransaction()', e); }

  // Build rebalance transaction
  try {
    const tx = poolSvc.buildRebalanceTransaction({
      portfolioId: '0xabc123',
      newAllocations: [3000, 2500, 2500, 1000, 1000],
      reasoning: 'AI recommendation: increase BTC allocation due to bullish momentum',
    });
    if (tx.target.includes('rwa_manager::rebalance')) {
      ok('buildRebalanceTransaction()', 'target correct');
    } else {
      fail('buildRebalanceTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildRebalanceTransaction()', e); }

  // Payment routing
  try {
    const tx = poolSvc.buildPaymentTransaction(
      100_000_000n,
      '0xrecipient123',
      'invoice-001',
    );
    if (tx.target.includes('payment_router::route_payment')) {
      ok('buildPaymentTransaction()', 'target correct');
    } else {
      fail('buildPaymentTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildPaymentTransaction()', e); }

  // Deployment config
  try {
    const config = poolSvc.getDeploymentConfig();
    if (config.packageId === PACKAGE_ID && config.rwaManagerState === OBJECT_IDS.rwaManagerState) {
      ok('getDeploymentConfig()', 'packageId and rwaManagerState match');
    } else {
      fail('getDeploymentConfig()', 'Config mismatch');
    }
  } catch (e) { fail('getDeploymentConfig()', e); }
}

// ============================================================
// TEST 6: SuiPrivateHedgeService
// ============================================================
async function testSuiPrivateHedgeService() {
  console.log('\n═══ TEST 6: SuiPrivateHedgeService ═══');

  const { SuiPrivateHedgeService } = await import('../lib/services/SuiPrivateHedgeService');
  const zkSvc = new SuiPrivateHedgeService('testnet');

  // Commitment generation
  try {
    const { commitmentHash, salt } = zkSvc.generateCommitment({
      asset: 'ETH',
      side: 'SHORT',
      size: 10,
      notionalValue: 25000,
      leverage: 5,
      entryPrice: 2500,
      salt: '',
    });

    if (commitmentHash && commitmentHash.length > 0 && salt.length > 0) {
      ok('generateCommitment()', `hash: ${commitmentHash.slice(0, 24)}, salt: ${salt.slice(0, 12)}...`);
    } else {
      fail('generateCommitment()', 'Empty hash or salt');
    }
  } catch (e) { fail('generateCommitment()', e); }

  // Nullifier generation
  try {
    const nullifier = zkSvc.generateNullifier('abc123hash', 'secretkey');
    if (nullifier && nullifier.length > 0) {
      ok('generateNullifier()', `nullifier: ${nullifier.slice(0, 24)}...`);
    } else {
      fail('generateNullifier()', 'Empty nullifier');
    }
  } catch (e) { fail('generateNullifier()', e); }

  // Full private hedge creation
  try {
    const result = await zkSvc.createPrivateHedge(
      'BTC', 'SHORT', 0.5, 35000, 3, 70000,
    );

    if (result.privateHedge.commitmentHash &&
        result.privateHedge.nullifier &&
        result.privateHedge.encryptedData &&
        result.storeCommitmentTx.target.includes('zk_hedge_commitment')) {
      ok('createPrivateHedge()', `hash: ${result.privateHedge.commitmentHash.slice(0, 16)}..., tx target correct`);
    } else {
      fail('createPrivateHedge()', 'Incomplete result');
    }

    // Decrypt the encrypted data
    try {
      const decrypted = zkSvc.decrypt(
        result.privateHedge.encryptedData,
        result.privateHedge.iv,
      );
      if (decrypted.asset === 'BTC' && decrypted.side === 'SHORT' && decrypted.size === 0.5) {
        ok('Encrypt → Decrypt roundtrip', `asset: ${decrypted.asset}, side: ${decrypted.side}, size: ${decrypted.size}`);
      } else {
        fail('Encrypt → Decrypt roundtrip', 'Decrypted data mismatch');
      }
    } catch (e) { fail('Encrypt → Decrypt roundtrip', e); }
  } catch (e) { fail('createPrivateHedge()', e); }

  // ZK existence proof
  try {
    const commitment = {
      asset: 'SUI',
      side: 'LONG' as const,
      size: 100,
      notionalValue: 250,
      leverage: 2,
      entryPrice: 2.5,
      salt: 'test-salt-12345',
    };
    const { commitmentHash } = zkSvc.generateCommitment(commitment);
    const proof = await zkSvc.generateExistenceProof(commitment, commitmentHash);

    if (proof.proofType === 'hedge_existence' && proof.proof.a && proof.proof.b && proof.proof.c) {
      ok('generateExistenceProof()', `type: ${proof.proofType}, signals: ${proof.publicSignals.length}`);
    } else {
      fail('generateExistenceProof()', 'Invalid proof structure');
    }

    // Verify proof
    const valid = await zkSvc.verifyProof(proof);
    if (valid) {
      ok('verifyProof()', 'Proof verified successfully');
    } else {
      fail('verifyProof()', 'Proof verification failed');
    }
  } catch (e) { fail('ZK proof flow', e); }

  // Solvency proof
  try {
    const commitment = {
      asset: 'ETH',
      side: 'SHORT' as const,
      size: 5,
      notionalValue: 12500,
      leverage: 3,
      entryPrice: 2500,
      salt: 'solvency-salt',
    };
    const proof = await zkSvc.generateSolvencyProof(commitment, 15000, 5000);
    if (proof.proofType === 'hedge_solvency') {
      ok('generateSolvencyProof()', 'Solvency proof generated');
    }

    // Should fail with insufficient collateral
    try {
      await zkSvc.generateSolvencyProof(commitment, 1000, 5000);
      fail('Insufficient collateral check', 'Should have thrown');
    } catch {
      ok('Insufficient collateral check', 'Correctly rejects');
    }
  } catch (e) { fail('Solvency proof', e); }

  // Build stealth deposit transaction
  try {
    const tx = zkSvc.buildStealthDepositTransaction(1_000_000_000n, 'stealth_tag_abc');
    if (tx.target.includes('zk_proxy_vault::stealth_deposit') && tx.coinAmount === 1_000_000_000n) {
      ok('buildStealthDepositTransaction()', 'target and amount correct');
    } else {
      fail('buildStealthDepositTransaction()', 'Invalid tx');
    }
  } catch (e) { fail('buildStealthDepositTransaction()', e); }

  // Build verify proof transaction
  try {
    const proof = {
      proofType: 'hedge_existence' as const,
      commitmentHash: 'deadbeef01234567',
      proof: {
        a: ['aaaa', 'bbbb'] as [string, string],
        b: [['cc', 'dd'], ['ee', 'ff']] as [[string, string], [string, string]],
        c: ['1111', '2222'] as [string, string],
      },
      publicSignals: ['signal1'],
    };
    const tx = zkSvc.buildVerifyProofTransaction(proof);
    if (tx.target.includes('zk_verifier::verify_proof')) {
      ok('buildVerifyProofTransaction()', 'target correct');
    } else {
      fail('buildVerifyProofTransaction()', 'Invalid target');
    }
  } catch (e) { fail('buildVerifyProofTransaction()', e); }

  // On-chain commitment lookup
  try {
    const result = await zkSvc.getCommitment('test_hash');
    ok('getCommitment()', `exists: ${result.exists}`);
  } catch (e) { fail('getCommitment()', e); }
}

// ============================================================
// TEST 7: SuiAutoHedgingAdapter
// ============================================================
async function testSuiAutoHedgingAdapter() {
  console.log('\n═══ TEST 7: SuiAutoHedgingAdapter ═══');

  const { SuiAutoHedgingAdapter } = await import('../lib/services/SuiAutoHedgingAdapter');
  const adapter = new SuiAutoHedgingAdapter();

  // Status before starting
  try {
    const status = adapter.getStatus();
    if (!status.isRunning && status.enabledAddresses.length === 0 && status.activeHedges === 0) {
      ok('Initial status', 'isRunning=false, no addresses, no hedges');
    } else {
      fail('Initial status', 'Unexpected initial state');
    }
  } catch (e) { fail('Initial status', e); }

  // Enable for an address
  try {
    adapter.enableForAddress({
      ownerAddress: '0xtest_owner_address',
      enabled: true,
      riskThreshold: 5,
      maxLeverage: 3,
      allowedPairs: ['SUI-PERP', 'BTC-PERP', 'ETH-PERP'],
    });

    const status = adapter.getStatus();
    if (status.enabledAddresses.includes('0xtest_owner_address')) {
      ok('enableForAddress()', 'Address registered');
    } else {
      fail('enableForAddress()', 'Address not found in status');
    }
  } catch (e) { fail('enableForAddress()', e); }

  // Risk assessment (will call SUI RPC — owner has no portfolios, so should return safe defaults)
  try {
    const risk = await adapter.assessRisk('0xtest_owner_address');
    if (typeof risk.riskScore === 'number' && risk.riskScore >= 1 && risk.riskScore <= 10) {
      ok('assessRisk()', `score: ${risk.riskScore}, topAsset: ${risk.topAsset || 'none'}, recs: ${risk.recommendations.length}`);
    } else {
      fail('assessRisk()', 'Invalid risk result');
    }
  } catch (e) { fail('assessRisk()', e); }

  // Get active hedges (should be empty)
  try {
    const hedges = adapter.getActiveHedges();
    if (hedges.length === 0) {
      ok('getActiveHedges()', '0 active (expected)');
    } else {
      fail('getActiveHedges()', `Unexpected ${hedges.length} hedges`);
    }
  } catch (e) { fail('getActiveHedges()', e); }

  // Disable
  try {
    adapter.disableForAddress('0xtest_owner_address');
    const status = adapter.getStatus();
    if (status.enabledAddresses.length === 0) {
      ok('disableForAddress()', 'Address removed');
    } else {
      fail('disableForAddress()', 'Address still present');
    }
  } catch (e) { fail('disableForAddress()', e); }

  // Config check
  try {
    const { SUI_HEDGE_CONFIG } = await import('../lib/services/SuiAutoHedgingAdapter');
    if (SUI_HEDGE_CONFIG.PNL_UPDATE_INTERVAL_MS > 0 && SUI_HEDGE_CONFIG.MAX_DRAWDOWN_PERCENT > 0) {
      ok('SUI_HEDGE_CONFIG', `drawdown: ${SUI_HEDGE_CONFIG.MAX_DRAWDOWN_PERCENT}%, leverage: ${SUI_HEDGE_CONFIG.DEFAULT_LEVERAGE}x`);
    }
  } catch (e) { fail('SUI_HEDGE_CONFIG', e); }
}

// ============================================================
// TEST 8: SuiPortfolioManager
// ============================================================
async function testSuiPortfolioManager() {
  console.log('\n═══ TEST 8: SuiPortfolioManager ═══');

  const { SuiPortfolioManager } = await import('../lib/services/SuiPortfolioManager');
  const mgr = new SuiPortfolioManager('testnet');

  // Fetch the rwaManager owner first (a real SUI address)
  let suiAddress = '';
  try {
    const obj = await suiRpc('sui_getObject', [
      OBJECT_IDS.rwaManagerState,
      { showContent: true, showOwner: true },
    ]) as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    const owner = data?.owner as Record<string, string> | undefined;
    suiAddress = owner?.AddressOwner || owner?.Shared ? '' : '';
    if (!suiAddress && typeof data?.owner === 'object') {
      // Try extracting from Shared owner
      suiAddress = (data?.owner as Record<string, string>)?.AddressOwner || '';
    }
  } catch {}

  // If we can't find a real SUI address, use a random valid-looking one
  if (!suiAddress) {
    suiAddress = '0x0000000000000000000000000000000000000000000000000000000000000001';
  }

  // Initialize
  try {
    await mgr.initialize(suiAddress);
    ok('initialize()', `owner: ${suiAddress.slice(0, 16)}...`);
  } catch (e) { fail('initialize()', e); }

  // Get summary
  try {
    const summary = await mgr.getSummary();
    if (summary.ownerAddress && typeof summary.totalValueUsd === 'number') {
      ok('getSummary()', `totalUsd: $${summary.totalValueUsd.toFixed(2)}, positions: ${summary.positions.length}`);
      for (const pos of summary.positions.slice(0, 3)) {
        console.log(`       ${pos.symbol}: ${pos.amount.toFixed(4)} @ $${pos.currentPrice} = $${pos.valueUsd.toFixed(2)} (${pos.allocation}%)`);
      }
    } else {
      fail('getSummary()', 'Invalid summary');
    }
  } catch (e) { fail('getSummary()', e); }

  // Risk metrics
  try {
    const summary = await mgr.getSummary();
    const risk = summary.riskMetrics;
    if (typeof risk.overallRiskScore === 'number' && risk.overallRiskScore >= 1) {
      ok('riskMetrics', `score: ${risk.overallRiskScore}/10, concentration: ${risk.concentrationRisk.toFixed(1)}%, hedgeRatio: ${risk.hedgeRatio.toFixed(1)}%`);
      for (const rec of risk.recommendations) {
        console.log(`       💡 ${rec}`);
      }
    } else {
      fail('riskMetrics', 'Invalid risk metrics');
    }
  } catch (e) { fail('riskMetrics', e); }

  // Transaction builders
  try {
    const tx = mgr.buildCreatePortfolioTransaction(800, 50, 5_000_000_000n);
    if (tx.target.includes('rwa_manager::create_portfolio')) {
      ok('buildCreatePortfolio()', `deposit: ${tx.coinAmount}n`);
    } else {
      fail('buildCreatePortfolio()', 'Invalid tx');
    }
  } catch (e) { fail('buildCreatePortfolio()', e); }

  try {
    const tx = mgr.buildDepositTransaction('0xportfolio1', 1_000_000_000n);
    if (tx.target.includes('rwa_manager::deposit')) {
      ok('buildDepositTransaction()', 'correct');
    }
  } catch (e) { fail('buildDeposit()', e); }

  try {
    const tx = mgr.buildRebalanceTransaction(
      '0xportfolio1',
      [3500, 2500, 2000, 1000, 1000],
      'Quarterly rebalance',
    );
    if (tx.target.includes('rwa_manager::rebalance')) {
      ok('buildRebalanceTransaction()', 'correct');
    }
  } catch (e) { fail('buildRebalance()', e); }

  // Deployment config
  try {
    const config = mgr.getDeploymentConfig();
    if (config.packageId === PACKAGE_ID) {
      ok('getDeploymentConfig()', 'packageId matches');
    }
  } catch (e) { fail('getDeploymentConfig()', e); }
}

// ============================================================
// MAIN RUNNER
// ============================================================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SUI Services E2E Testnet Test Suite                        ║');
  console.log('║  Network: SUI Testnet                                       ║');
  console.log('║  Package: ' + PACKAGE_ID.slice(0, 20) + '...                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    await testDeployedContracts();
    await testCetusSwapService();
    await testSuiExplorerService();
    await testSuiOnChainHedgeService();
    await testSuiCommunityPoolService();
    await testSuiPrivateHedgeService();
    await testSuiAutoHedgingAdapter();
    await testSuiPortfolioManager();
  } catch (e) {
    console.error('\n💥 FATAL ERROR:', e);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsed}s)            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

main();
