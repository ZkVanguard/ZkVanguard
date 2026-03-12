/**
 * Complete V2 -> V3 Migration Script
 * 
 * Steps:
 * 1. Upgrade V2 with adminMigrateFunds function
 * 2. Enable emergency mode on V2
 * 3. Get V2 investor snapshot
 * 4. Migrate all funds from V2 to admin
 * 5. Deposit to V3 for each investor proportionally
 * 6. Sync DB
 */
const hre = require("hardhat");
const { neon } = require('@neondatabase/serverless');

const V2_PROXY = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const V3_PROXY = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const [admin] = await hre.ethers.getSigners();
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           V2 -> V3 COMMUNITY POOL MIGRATION                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nAdmin: ${admin.address}`);
  console.log(`V2: ${V2_PROXY}`);
  console.log(`V3: ${V3_PROXY}\n`);

  const Pool = await hre.ethers.getContractFactory("CommunityPool");
  const v2 = Pool.attach(V2_PROXY);
  const v3 = Pool.attach(V3_PROXY);
  const usdc = await hre.ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC_ADDRESS);

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Snapshot V2 investors
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 1: Snapshot V2 Investors ─────────────────────────────┐');
  
  const v2MemberCount = await v2.getMemberCount();
  const v2TotalShares = await v2.totalShares();
  const v2UsdcBalance = await usdc.balanceOf(V2_PROXY);
  
  console.log(`│  V2 Members: ${v2MemberCount}`);
  console.log(`│  V2 Total Shares: ${hre.ethers.formatUnits(v2TotalShares, 18)}`);
  console.log(`│  V2 USDC: $${hre.ethers.formatUnits(v2UsdcBalance, 6)}`);

  const investors = [];
  const seenAddresses = new Set();
  
  for (let i = 0; i < Number(v2MemberCount); i++) {
    const addr = await v2.memberList(i);
    if (seenAddresses.has(addr.toLowerCase())) continue;
    seenAddresses.add(addr.toLowerCase());
    
    const member = await v2.members(addr);
    const shares = member.shares;
    
    if (shares > 0n) {
      const usdcShare = (shares * v2UsdcBalance) / v2TotalShares;
      investors.push({
        address: addr,
        shares: shares,
        usdcShare: usdcShare,
        depositedUSD: member.depositedUSD
      });
      console.log(`│  ${addr.slice(0,10)}...: ${Number(shares)/1e18} shares -> $${Number(usdcShare)/1e6}`);
    }
  }
  
  console.log(`│  Total investors: ${investors.length}`);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Upgrade V2 with migration function
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 2: Upgrade V2 for Migration ──────────────────────────┐');
  
  // Check if already has adminMigrateFunds
  let needsUpgrade = true;
  try {
    await v2.adminMigrateFunds.staticCall(admin.address);
    needsUpgrade = false;
    console.log('│  V2 already has migration function ✓');
  } catch (e) {
    if (e.message.includes('Enable emergency mode')) {
      needsUpgrade = false;
      console.log('│  V2 already has migration function ✓');
    } else {
      console.log('│  V2 needs upgrade...');
    }
  }

  if (needsUpgrade) {
    console.log('│  Compiling new implementation...');
    await hre.run('compile');
    
    console.log('│  Upgrading V2 proxy...');
    const upgraded = await hre.upgrades.upgradeProxy(V2_PROXY, Pool, {
      unsafeAllow: ['constructor']
    });
    await upgraded.waitForDeployment();
    console.log('│  V2 Upgraded ✓');
  }
  
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Enable emergency mode on V2
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 3: Enable Emergency Mode on V2 ───────────────────────┐');
  
  const isEmergency = await v2.emergencyWithdrawEnabled();
  if (!isEmergency) {
    const tx = await v2.setEmergencyWithdraw(true);
    await tx.wait();
    console.log('│  Emergency mode enabled ✓');
  } else {
    console.log('│  Emergency mode already enabled ✓');
  }
  
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Migrate funds from V2 to admin
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 4: Migrate Funds from V2 ─────────────────────────────┐');
  
  const adminBalBefore = await usdc.balanceOf(admin.address);
  console.log(`│  Admin USDC before: $${hre.ethers.formatUnits(adminBalBefore, 6)}`);
  
  try {
    const migrateTx = await v2.adminMigrateFunds(admin.address);
    await migrateTx.wait();
    
    const adminBalAfter = await usdc.balanceOf(admin.address);
    const migrated = adminBalAfter - adminBalBefore;
    console.log(`│  Migrated: $${hre.ethers.formatUnits(migrated, 6)} ✓`);
  } catch (e) {
    console.log(`│  Migration error: ${e.message.slice(0, 60)}`);
    throw e;
  }
  
  const v2UsdcAfter = await usdc.balanceOf(V2_PROXY);
  console.log(`│  V2 USDC remaining: $${hre.ethers.formatUnits(v2UsdcAfter, 6)}`);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Deposit to V3 for each investor
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 5: Deposit to V3 for Each Investor ───────────────────┐');
  
  // Approve V3 to spend USDC
  const totalToDeposit = investors.reduce((sum, inv) => sum + inv.usdcShare, 0n);
  console.log(`│  Total to deposit: $${hre.ethers.formatUnits(totalToDeposit, 6)}`);
  
  await (await usdc.approve(V3_PROXY, totalToDeposit)).wait();
  console.log('│  Approved V3 ✓');
  
  for (const investor of investors) {
    if (investor.usdcShare === 0n) continue;
    console.log(`│  ${investor.address.slice(0,10)}...: $${Number(investor.usdcShare)/1e6} (tracked in DB)`);
  }
  
  // Deposit all to V3 (credited to admin on-chain, tracked per-investor in DB)
  const depositTx = await v3.deposit(totalToDeposit, 0);
  await depositTx.wait();
  console.log(`│  All funds deposited to V3 as admin ✓`);
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: Sync DB with migrated data
  // ═══════════════════════════════════════════════════════════════
  console.log('┌─ STEP 6: Sync Database ─────────────────────────────────────┐');
  
  // Get new V3 state
  const v3TotalShares = await v3.totalShares();
  const v3Nav = await v3.calculateTotalNAV();
  const v3SharePrice = Number(v3Nav) / 1e6 / (Number(v3TotalShares) / 1e18);
  
  console.log(`│  V3 Total Shares: ${hre.ethers.formatUnits(v3TotalShares, 18)}`);
  console.log(`│  V3 NAV: $${hre.ethers.formatUnits(v3Nav, 6)}`);
  console.log(`│  V3 Share Price: $${v3SharePrice.toFixed(6)}`);
  
  // Update pool state
  await sql`
    UPDATE community_pool_state 
    SET 
      total_shares = ${Number(v3TotalShares) / 1e18},
      total_value_usd = ${Number(v3Nav) / 1e6},
      share_price = ${v3SharePrice},
      allocations = ${JSON.stringify({ USDC: { percentage: 100, valueUSD: Number(v3Nav) / 1e6, amount: Number(v3Nav) / 1e6, price: 1 }})},
      updated_at = NOW()
    WHERE id = 1
  `;
  console.log('│  Pool state updated ✓');
  
  // Get all V3 members for sync
  const v3MemberCount = await v3.getMemberCount();
  const v3Members = new Map();
  
  for (let i = 0; i < Number(v3MemberCount); i++) {
    const addr = await v3.memberList(i);
    if (!v3Members.has(addr.toLowerCase())) {
      const member = await v3.members(addr);
      const shares = Number(member.shares) / 1e18;
      if (shares > 0) {
        v3Members.set(addr.toLowerCase(), { address: addr, shares });
      }
    }
  }
  
  // Update DB for V3 on-chain members
  for (const [, member] of v3Members) {
    const exists = await sql`SELECT 1 FROM community_pool_shares WHERE LOWER(wallet_address) = LOWER(${member.address})`;
    if (exists.length > 0) {
      await sql`UPDATE community_pool_shares SET shares = ${member.shares} WHERE LOWER(wallet_address) = LOWER(${member.address})`;
    } else {
      await sql`INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd) VALUES (${member.address}, ${member.shares}, ${member.shares})`;
    }
  }
  
  // Also add records for V2 investors (their shares are held by admin on-chain but tracked in DB)
  for (const inv of investors) {
    // Skip if already an on-chain V3 member
    if (v3Members.has(inv.address.toLowerCase())) continue;
    
    const invShares = Number(inv.usdcShare) / 1e6; // USDC amount ≈ shares at ~$1
    const exists = await sql`SELECT shares FROM community_pool_shares WHERE LOWER(wallet_address) = LOWER(${inv.address})`;
    
    if (exists.length > 0) {
      const currentShares = Number(exists[0].shares);
      await sql`UPDATE community_pool_shares SET shares = ${currentShares + invShares} WHERE LOWER(wallet_address) = LOWER(${inv.address})`;
      console.log(`│  Updated: ${inv.address.slice(0,10)}... +${invShares.toFixed(2)} shares`);
    } else {
      await sql`INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd) VALUES (${inv.address}, ${invShares}, ${Number(inv.depositedUSD)/1e6})`;
      console.log(`│  Added: ${inv.address.slice(0,10)}... ${invShares.toFixed(2)} shares`);
    }
  }
  
  console.log('│  Shareholders synced ✓');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  // ═══════════════════════════════════════════════════════════════
  // FINAL VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    MIGRATION COMPLETE                       ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  
  const finalV3Usdc = await usdc.balanceOf(V3_PROXY);
  const finalV3Shares = await v3.totalShares();
  const finalV3Nav = await v3.calculateTotalNAV();
  
  console.log(`║  V2 USDC: $${hre.ethers.formatUnits(await usdc.balanceOf(V2_PROXY), 6).padStart(12)} (should be 0)       ║`);
  console.log(`║  V3 USDC: $${hre.ethers.formatUnits(finalV3Usdc, 6).padStart(12)}                       ║`);
  console.log(`║  V3 Shares: ${hre.ethers.formatUnits(finalV3Shares, 18).padStart(12)}                       ║`);
  console.log(`║  V3 NAV: $${hre.ethers.formatUnits(finalV3Nav, 6).padStart(12)}                       ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
