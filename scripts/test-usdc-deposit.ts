/**
 * Test USDC Deposit on SUI Community Pool
 * Run: npx tsx scripts/test-usdc-deposit.ts
 */

// Try multiple ports - dev server may be on 3000, 3002, 3003, or 3099
async function findServer(): Promise<string> {
  for (const port of [3099, 3003, 3002, 3000]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/sui/community-pool?action=allocation&network=testnet`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`✅ Server found on port ${port}`);
        return `http://localhost:${port}`;
      }
    } catch {}
  }
  throw new Error('No dev server found on ports 3000/3002/3003/3099');
}

let API_BASE = 'http://localhost:3003';

async function testDeposit() {
  console.log('=== Testing SUI USDC Pool Deposit ===\n');
  
  API_BASE = await findServer();
  
  const wallet = '0xac13bb75d72169cee6dcef201bf6217a4f20228248bede51bb7893ae43a78c38';
  const amountUsdc = 20;
  
  // 1. Check current position
  console.log('1. Checking current position...');
  try {
    const posRes = await fetch(`${API_BASE}/api/sui/community-pool?action=user-position&wallet=${wallet}&network=testnet`);
    const pos = await posRes.json();
    console.log('Current position:', JSON.stringify(pos, null, 2));
  } catch (e) {
    console.log('Error checking position:', e);
  }
  
  // 2. Check admin wallet
  console.log('\n2. Checking admin wallet...');
  try {
    const adminRes = await fetch(`${API_BASE}/api/sui/community-pool?action=admin-wallet&network=testnet`);
    const admin = await adminRes.json();
    console.log('Admin wallet:', JSON.stringify(admin, null, 2));
  } catch (e) {
    console.log('Error checking admin:', e);
  }
  
  // 3. Record deposit
  console.log('\n3. Recording 20 USDC deposit...');
  try {
    const depositRes = await fetch(`${API_BASE}/api/sui/community-pool?action=record-deposit&network=testnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        amountUsdc: amountUsdc,
        allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
        txDigest: `usdc-deposit-${Date.now()}`,
      }),
    });
    const deposit = await depositRes.json();
    console.log('Deposit result:', JSON.stringify(deposit, null, 2));
  } catch (e) {
    console.log('Error recording deposit:', e);
  }
  
  // 4. Check updated position
  console.log('\n4. Checking updated position...');
  try {
    const posRes = await fetch(`${API_BASE}/api/sui/community-pool?action=user-position&wallet=${wallet}&network=testnet`);
    const pos = await posRes.json();
    console.log('Updated position:', JSON.stringify(pos, null, 2));
  } catch (e) {
    console.log('Error checking position:', e);
  }

  // 5. Check allocation
  console.log('\n5. Checking pool allocation...');
  try {
    const allocRes = await fetch(`${API_BASE}/api/sui/community-pool?action=allocation&network=testnet`);
    const alloc = await allocRes.json();
    console.log('Allocation:', JSON.stringify(alloc, null, 2));
  } catch (e) {
    console.log('Error checking allocation:', e);
  }

  // 6. Test withdrawal of 5 USDC
  console.log('\n6. Testing withdrawal of 5 USDC (shares)...');
  try {
    const withdrawRes = await fetch(`${API_BASE}/api/sui/community-pool?action=record-withdraw&network=testnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        sharesToBurn: 5,
        allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
      }),
    });
    const withdraw = await withdrawRes.json();
    console.log('Withdraw result:', JSON.stringify(withdraw, null, 2));
  } catch (e) {
    console.log('Error withdrawing:', e);
  }

  // 7. Check final position
  console.log('\n7. Checking final position after withdrawal...');
  try {
    const posRes = await fetch(`${API_BASE}/api/sui/community-pool?action=user-position&wallet=${wallet}&network=testnet`);
    const pos = await posRes.json();
    console.log('Final position:', JSON.stringify(pos, null, 2));
  } catch (e) {
    console.log('Error checking position:', e);
  }
  
  console.log('\n=== Test Complete ===');
}

testDeposit().catch(console.error);
