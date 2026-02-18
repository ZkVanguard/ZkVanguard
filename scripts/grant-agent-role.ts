/**
 * Grant AGENT_ROLE to relayer for gasless hedge execution
 * Relayer needs AGENT_ROLE to call agentOpenHedge() on HedgeExecutor
 * 
 * Usage:
 *   npx hardhat run scripts/grant-agent-role.ts --network cronos-testnet
 */

import { ethers } from 'hardhat';

const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const RELAYER_ADDRESS = '0xb61C1cF5152015E66d547F9c1c45cC592a870D10'; // From RELAYER_PRIVATE_KEY

async function main() {
  console.log('\n🎭 GRANTING AGENT_ROLE TO RELAYER\n' + '='.repeat(50));

  const [admin] = await ethers.getSigners();
  console.log('Admin:', admin.address);
  console.log('Relayer:', RELAYER_ADDRESS);

  const HedgeExecutor = await ethers.getContractAt('HedgeExecutor', HEDGE_EXECUTOR);

  // Compute AGENT_ROLE hash
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROLE'));
  console.log('\nAGENT_ROLE:', AGENT_ROLE);

  // Check if relayer already has role
  const hasRole = await HedgeExecutor.hasRole(AGENT_ROLE, RELAYER_ADDRESS);
  
  if (hasRole) {
    console.log('✅ Relayer already has AGENT_ROLE');
    return;
  }

  console.log('\n📝 Granting AGENT_ROLE to relayer...');
  const tx = await HedgeExecutor.grantRole(AGENT_ROLE, RELAYER_ADDRESS);
  await tx.wait();

  console.log('✅ AGENT_ROLE granted!');
  console.log('TX Hash:', tx.hash);

  // Verify
  const nowHasRole = await HedgeExecutor.hasRole(AGENT_ROLE, RELAYER_ADDRESS);
  console.log('\n✅ Verification:', nowHasRole ? 'SUCCESS' : 'FAILED');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
