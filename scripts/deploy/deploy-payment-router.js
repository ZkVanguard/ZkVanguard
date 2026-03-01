const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  console.log('\n📦 Deploying PaymentRouter...');
  const PaymentRouter = await hre.ethers.getContractFactory('PaymentRouter');
  const paymentRouter = await PaymentRouter.deploy(deployer.address, deployer.address);
  await paymentRouter.waitForDeployment();
  const address = await paymentRouter.getAddress();
  console.log(`  ✅ PaymentRouter deployed at: ${address}`);

  // Update deployment file
  const deploymentFile = path.join(__dirname, '..', '..', 'deployments', `${network}.json`);
  if (fs.existsSync(deploymentFile)) {
    const data = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    data.contracts.paymentRouter = {
      address,
      txHash: paymentRouter.deploymentTransaction()?.hash || '',
      blockNumber: paymentRouter.deploymentTransaction()?.blockNumber || 0,
    };
    fs.writeFileSync(deploymentFile, JSON.stringify(data, null, 2));
    console.log(`💾 Updated ${deploymentFile}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
