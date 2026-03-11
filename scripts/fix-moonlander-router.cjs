/**
 * Fix HedgeExecutor router to point to correct MockMoonlander
 */
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const deployment = JSON.parse(fs.readFileSync("./deployments/cronos-testnet.json"));
  const signers = await ethers.getSigners();
  
  if (!signers || signers.length === 0) {
    throw new Error("No signers available. Check your PRIVATE_KEY in .env");
  }
  
  const signer = signers[0];
  console.log("Signer:", signer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "CRO");
  
  const HEDGE_EXECUTOR = deployment.HedgeExecutorV2 || deployment.HedgeExecutor;
  const NEW_MOONLANDER = deployment.MockMoonlander;
  
  console.log("\nHedgeExecutor:", HEDGE_EXECUTOR);
  console.log("Current MockMoonlander in deployment:", NEW_MOONLANDER);
  
  const he = await ethers.getContractAt("HedgeExecutorV2", HEDGE_EXECUTOR);
  
  const currentRouter = await he.moonlanderRouter();
  console.log("Current Router in contract:", currentRouter);
  
  if (currentRouter.toLowerCase() === NEW_MOONLANDER.toLowerCase()) {
    console.log("\n✅ Already using correct MockMoonlander!");
    return;
  }
  
  console.log("\n🔄 Updating router to:", NEW_MOONLANDER);
  
  const tx = await he.setMoonlanderRouter(NEW_MOONLANDER);
  console.log("TX:", tx.hash);
  await tx.wait();
  
  const newRouter = await he.moonlanderRouter();
  console.log("New Router:", newRouter);
  console.log(newRouter.toLowerCase() === NEW_MOONLANDER.toLowerCase() ? "✅ Success!" : "❌ Failed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
