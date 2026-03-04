const { ethers } = require('ethers');

async function main() {
  console.log('=== OASIS SAPPHIRE TESTNET CONTRACT VERIFICATION ===');
  
  const provider = new ethers.JsonRpcProvider('https://testnet.sapphire.oasis.io');
  const contracts = {
    'ZKVerifier': '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1',
    'RWAManager': '0xd38A271Af05Cd09325f6758067d43457797Ff654',
    'GaslessCommitmentVerifier': '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B',
    'HedgeExecutor': '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8',
    'PaymentRouter': '0x170E8232E9e18eeB1839dB1d939501994f1e272F',
  };

  let live = 0;
  let missing = 0;

  for (const [name, addr] of Object.entries(contracts)) {
    try {
      const code = await provider.getCode(addr);
      const hasCode = code !== '0x' && code.length > 2;
      if (hasCode) {
        console.log(`  [LIVE] ${name}: ${addr} (${code.length} bytes bytecode)`);
        live++;
      } else {
        console.log(`  [MISSING] ${name}: ${addr}`);
        missing++;
      }
    } catch (e) {
      console.log(`  [ERROR] ${name}: ${e.message.slice(0, 100)}`);
      missing++;
    }
  }

  console.log(`\nSummary: ${live} live, ${missing} missing out of ${Object.keys(contracts).length}`);

  console.log('\n=== OASIS EMERALD TESTNET CHECK ===');
  try {
    const emeraldProvider = new ethers.JsonRpcProvider('https://testnet.emerald.oasis.io');
    const block = await emeraldProvider.getBlockNumber();
    console.log(`  Emerald RPC: Connected (block ${block})`);
    console.log('  Contracts deployed: NONE (template only)');
  } catch (e) {
    console.log(`  Emerald RPC: ${e.message.slice(0, 100)}`);
  }

  console.log('\n=== SAPPHIRE MAINNET CHECK ===');
  try {
    const sapphireMainProvider = new ethers.JsonRpcProvider('https://sapphire.oasis.io');
    const block = await sapphireMainProvider.getBlockNumber();
    console.log(`  Sapphire Mainnet RPC: Connected (block ${block})`);
    console.log('  Contracts deployed: NONE (addresses are 0x000...)');
  } catch (e) {
    console.log(`  Sapphire Mainnet RPC: ${e.message.slice(0, 100)}`);
  }
}

main().catch(e => console.error('Fatal:', e.message));
