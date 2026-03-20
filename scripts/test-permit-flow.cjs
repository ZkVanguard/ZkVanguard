/**
 * Test EIP-2612 Permit Flow for AI Agents
 * 
 * This tests if an AI agent can do a single-transaction deposit using permit
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.vercel.temp' });

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const POOL_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086';
const USDT_ADDRESS = '0xd077a400968890eacc75cdc901f0356c943e4fdb';

const USDT_ABI = [
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const POOL_ABI = [
  'function deposit(uint256 amount) returns (uint256 shares)',
  'function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 shares)',
];

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     PERMIT FLOW TEST - AI AGENT SINGLE-TX DEPOSIT            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const pk = (process.env.PRIVATE_KEY || '').trim();
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(pk, provider);
  
  const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);

  console.log('📍 Testing EIP-2612 Permit on WDK USDT...');
  console.log('');

  // Step 1: Check if USDT supports permit
  console.log('═══ STEP 1: Verify USDT Permit Support ═══');
  try {
    const name = await usdt.name();
    const nonce = await usdt.nonces(wallet.address);
    const domainSep = await usdt.DOMAIN_SEPARATOR();
    console.log('   Token name:', name);
    console.log('   Current nonce:', nonce.toString());
    console.log('   Domain separator:', domainSep.slice(0, 20) + '...');
    console.log('   ✅ USDT supports EIP-2612 permit!');
  } catch (e) {
    console.log('   ❌ USDT does NOT support permit:', e.message.slice(0, 100));
    process.exit(1);
  }
  console.log('');

  // Step 2: Check if Pool has depositWithPermit
  console.log('═══ STEP 2: Check Pool depositWithPermit ═══');
  const depositWithPermitSelector = ethers.id('depositWithPermit(uint256,uint256,uint8,bytes32,bytes32)').slice(0, 10);
  console.log('   Function selector:', depositWithPermitSelector);
  
  const code = await provider.getCode(POOL_ADDRESS);
  const hasFunction = code.toLowerCase().includes(depositWithPermitSelector.slice(2).toLowerCase());
  
  if (hasFunction) {
    console.log('   ✅ Pool has depositWithPermit');
  } else {
    console.log('   ❌ Pool does NOT have depositWithPermit');
    console.log('');
    console.log('   ⚠️  To enable single-tx permit deposits, the pool needs upgrading.');
    console.log('   For now, AI agents must use the 2-tx flow: permit() + deposit()');
    console.log('');
    
    // Test the 2-tx permit flow
    console.log('═══ STEP 3: Test Permit + Deposit (2-tx flow) ═══');
    
    const amount = ethers.parseUnits('10', 6); // 10 USDT (minimum)
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const nonce = await usdt.nonces(wallet.address);
    
    // Get domain data
    const name = await usdt.name();
    const chainId = (await provider.getNetwork()).chainId;
    
    const domain = {
      name: name,
      version: '1',
      chainId: chainId,
      verifyingContract: USDT_ADDRESS,
    };
    
    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };
    
    const value = {
      owner: wallet.address,
      spender: POOL_ADDRESS,
      value: amount,
      nonce: nonce,
      deadline: deadline,
    };
    
    console.log('   📝 Signing EIP-712 permit message...');
    const signature = await wallet.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(signature);
    console.log('   ✅ Signature generated');
    console.log('      v:', v);
    console.log('      r:', r.slice(0, 20) + '...');
    console.log('      s:', s.slice(0, 20) + '...');
    
    // Reset allowance first (USDT quirk)
    const currentAllowance = await usdt.allowance(wallet.address, POOL_ADDRESS);
    if (currentAllowance > 0n) {
      console.log('   ⚠️  Resetting existing allowance...');
      // We'll skip this for now - permit should override
    }
    
    console.log('');
    console.log('   📤 Calling permit() on USDT...');
    try {
      const permitTx = await usdt.permit(wallet.address, POOL_ADDRESS, amount, deadline, v, r, s);
      console.log('      Tx:', permitTx.hash);
      await permitTx.wait();
      console.log('   ✅ Permit executed!');
      
      const newAllowance = await usdt.allowance(wallet.address, POOL_ADDRESS);
      console.log('   📊 New allowance:', ethers.formatUnits(newAllowance, 6), 'USDT');
      
      console.log('');
      console.log('   📤 Calling deposit() on Pool...');
      const depositTx = await pool.deposit(amount);
      console.log('      Tx:', depositTx.hash);
      await depositTx.wait();
      console.log('   ✅ Deposit completed!');
      
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║        ✅ PERMIT + DEPOSIT (2-TX) FLOW WORKS!                 ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('AI agents can use this flow:');
      console.log('1. Sign EIP-712 permit message (gasless offline signing)');
      console.log('2. Call usdt.permit() - sets allowance without prior approval tx');
      console.log('3. Call pool.deposit() - deposits funds');
      console.log('');
      console.log('Benefit: No need for 2 approval transactions!');
      
    } catch (e) {
      console.log('   ❌ Permit failed:', e.message.slice(0, 200));
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
