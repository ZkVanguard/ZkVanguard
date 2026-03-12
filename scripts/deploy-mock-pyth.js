/**
 * Deploy MockPyth and configure CommunityPool to use it
 * This enables testing when real Pyth prices are stale
 */
const { ethers } = require("hardhat");

const POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";

const POOL_ABI = [
  "function setPythOracle(address _pythOracle) external",
  "function pythOracle() external view returns (address)"
];

async function main() {
  console.log("============================================================");
  console.log("   DEPLOYING MOCK PYTH ORACLE");
  console.log("============================================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Deploy MockPyth
  console.log("1. Deploying MockPyth...");
  const MockPyth = await ethers.getContractFactory("MockPyth");
  const mockPyth = await MockPyth.deploy();
  await mockPyth.waitForDeployment();
  const pythAddress = await mockPyth.getAddress();
  console.log("   ✅ MockPyth:", pythAddress);

  // Update CommunityPool to use MockPyth
  console.log("\n2. Updating CommunityPool Pyth oracle...");
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, deployer);
  
  const oldPyth = await pool.pythOracle();
  console.log("   Old Pyth:", oldPyth);
  
  const tx = await pool.setPythOracle(pythAddress);
  await tx.wait();
  
  const newPyth = await pool.pythOracle();
  console.log("   New Pyth:", newPyth);
  console.log("   ✅ Updated!");

  // Verify MockPyth has prices
  console.log("\n3. Verifying MockPyth prices...");
  const btcId = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const btcPrice = await mockPyth.getPriceUnsafe(btcId);
  console.log("   BTC Price:", Number(btcPrice.price) * Math.pow(10, Number(btcPrice.expo)));
  
  const ethId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const ethPrice = await mockPyth.getPriceUnsafe(ethId);
  console.log("   ETH Price:", Number(ethPrice.price) * Math.pow(10, Number(ethPrice.expo)));

  console.log("\n============================================================");
  console.log("   DEPLOYMENT COMPLETE");
  console.log("============================================================");
  console.log("\nMockPyth:", pythAddress);
  console.log("Pool updated to use MockPyth for price feeds.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
