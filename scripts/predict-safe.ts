
import { SafeUtils } from '../lib/services/safe-utils';
import { SAFE_CONFIG } from '../lib/config/aa-paymaster';

const OWNER = process.argv[2] ? process.argv[2] : '0xbEe5BFeEfB43B7BfCe00B0Dcb45bb65Be0F37a69';
const CHAIN_ID = 11155111;

async function main() {
    console.log(`Predicting Safe address for owner: ${OWNER} on chain ${CHAIN_ID}`);
    const info = await SafeUtils.getSafeAddress(OWNER, CHAIN_ID, 0);
    console.log('----------------------------------------');
    console.log(`Predicted Safe: ${info.address}`);
    console.log('----------------------------------------');
}

main().catch(console.error);
