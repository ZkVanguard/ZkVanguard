/**
 * Debug HedgeExecutorV2 on Cronos Testnet
 * Checks contract state and MockMoonlander compatibility
 */

const { ethers } = require("hardhat");

const deploymentInfo = require("../../deployments/hedge-executor-v2-testnet.json");

const HEDGE_EXECUTOR_V2 = deploymentInfo.contracts.hedgeExecutorV2Proxy;
const USDC_ADDRESS = deploymentInfo.contracts.collateralToken;
const MOCK_MOONLANDER = deploymentInfo.contracts.moonlanderRouter;

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("\n═══ DEBUG HedgeExecutorV2 ═══\n");
  console.log("Signer:", signer.address);
  
  // Get contracts
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutorV2", HEDGE_EXECUTOR_V2, signer);
  const mockMoonlander = await ethers.getContractAt("MockMoonlander", MOCK_MOONLANDER, signer);
  
  // Check HedgeExecutorV2 state
  console.log("\n--- HedgeExecutorV2 State ---");
  const collateralToken = await hedgeExecutor.collateralToken();
  const moonlanderRouter = await hedgeExecutor.moonlanderRouter();
  const paused = await hedgeExecutor.paused();
  const maxLeverage = await hedgeExecutor.maxLeverage();
  const minCollateral = await hedgeExecutor.minCollateral();
  
  console.log("collateralToken:", collateralToken);
  console.log("moonlanderRouter:", moonlanderRouter);
  console.log("paused:", paused);
  console.log("maxLeverage:", maxLeverage.toString());
  console.log("minCollateral:", minCollateral.toString(), "(", ethers.formatUnits(minCollateral, 6), "USDC)");
  
  // Check if collateral matches deployment
  console.log("\n--- Token Check ---");
  console.log("Expected USDC:", USDC_ADDRESS);
  console.log("Contract USDC:", collateralToken);
  console.log("Match:", collateralToken.toLowerCase() === USDC_ADDRESS.toLowerCase());
  
  // Check MockMoonlander
  console.log("\n--- MockMoonlander State ---");
  const moonlanderCollateral = await mockMoonlander.collateral();
  const moonlanderOwner = await mockMoonlander.owner();
  console.log("MockMoonlander collateral:", moonlanderCollateral);
  console.log("MockMoonlander owner:", moonlanderOwner);
  console.log("We are owner:", moonlanderOwner.toLowerCase() === signer.address.toLowerCase());
  
  // Check if MockMoonlander points to same USDC
  console.log("\n--- Collateral Compatibility ---");
  console.log("HedgeExecutorV2 uses:", collateralToken);
  console.log("MockMoonlander uses:", moonlanderCollateral);
  console.log("Match:", moonlanderCollateral.toLowerCase() === collateralToken.toLowerCase());
  
  // Get MockMoonlander USDC balance
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", collateralToken, signer);
  const moonlanderUsdcBalance = await usdc.balanceOf(MOCK_MOONLANDER);
  const hedgeExecutorUsdcBalance = await usdc.balanceOf(HEDGE_EXECUTOR_V2);
  const signerUsdcBalance = await usdc.balanceOf(signer.address);
  
  console.log("\n--- USDC Balances ---");
  console.log("MockMoonlander:", ethers.formatUnits(moonlanderUsdcBalance, 6), "USDC");
  console.log("HedgeExecutorV2:", ethers.formatUnits(hedgeExecutorUsdcBalance, 6), "USDC");
  console.log("Signer:", ethers.formatUnits(signerUsdcBalance, 6), "USDC");
  
  // Check allowance
  const allowance = await usdc.allowance(signer.address, HEDGE_EXECUTOR_V2);
  console.log("\n--- Allowances ---");
  console.log("Signer -> HedgeExecutorV2:", ethers.formatUnits(allowance, 6), "USDC");
  
  // Check BTC price in MockMoonlander
  const btcPrice = await mockMoonlander.mockPrices(0);
  console.log("\n--- Mock Prices ---");
  console.log("BTC (pair 0):", ethers.formatUnits(btcPrice, 10), "USD");
  
  console.log("\n═══ END DEBUG ═══\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
