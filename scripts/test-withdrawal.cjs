const { ethers } = require("hardhat");

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("   ZK PROXY VAULT - WITHDRAWAL TEST (LIVE TESTNET)");
  console.log("=".repeat(70) + "\n");

  const VAULT_ADDRESS = "0x7F75Ca65D32752607fF481F453E4fbD45E61FdFd";
  const VERIFIER_ADDRESS = "0x47812EFFe0Aed4D46C489E002214A05B26b71b0b";

  const [owner] = await ethers.getSigners();
  console.log("Owner Address:", owner.address);
  
  const balance = await ethers.provider.getBalance(owner.address);
  console.log("Owner Balance:", ethers.formatEther(balance), "TCRO\n");

  const vault = await ethers.getContractAt("ZKProxyVault", VAULT_ADDRESS);
  const verifier = await ethers.getContractAt("ZKSTARKVerifier", VERIFIER_ADDRESS);

  console.log("[1] Creating new proxy for withdrawal test...");
  
  const secret = ethers.hexlify(ethers.randomBytes(32));
  const ownerCommitment = ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [owner.address, secret])
  );
  
  console.log("    Secret:", secret.slice(0, 20) + "...");

  const tx1 = await vault.createProxy(ownerCommitment);
  const receipt1 = await tx1.wait();
  
  let proxyAddress, zkBindingHash;
  for (const log of receipt1.logs) {
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed && parsed.name === "ProxyCreated") {
        proxyAddress = parsed.args.proxyAddress;
        zkBindingHash = parsed.args.zkBindingHash;
        break;
      }
    } catch {}
  }
  
  console.log("    Proxy Created:", proxyAddress);
  console.log("    ZK Binding Hash:", zkBindingHash.slice(0, 20) + "...");

  console.log("\n[2] Depositing 0.0001 TCRO to proxy...");
  const depositAmount = ethers.parseEther("0.0001");
  
  const tx2 = await vault.deposit(proxyAddress, { value: depositAmount });
  await tx2.wait();
  
  const proxyBalance = await vault.getProxyBalance(proxyAddress);
  console.log("    Proxy Balance:", ethers.formatEther(proxyBalance), "TCRO");

  console.log("\n[3] Generating ZK proof using on-chain helper...");
  
  const withdrawAmount = ethers.parseEther("0.00005");
  const timestamp = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  
  // Use the verifier's helper function to compute proof components
  const [commitment, response] = await verifier.computeProofComponents(
    owner.address,
    proxyAddress,
    zkBindingHash,
    timestamp
  );
  
  console.log("    Commitment:", commitment.slice(0, 20) + "...");
  console.log("    Response:", response.slice(0, 20) + "...");
  
  // Build the proof (64 bytes: commitment + response)
  const zkProof = ethers.concat([commitment, response]);
  console.log("    Proof length:", zkProof.length, "bytes");
  
  // Build public inputs: [ownerHash, proxyHash, bindingHash, timestamp]
  const ownerHash = ethers.keccak256(ethers.solidityPacked(["address"], [owner.address]));
  const proxyHash = ethers.keccak256(ethers.solidityPacked(["address"], [proxyAddress]));
  
  const publicInputs = [
    ownerHash,
    proxyHash,
    zkBindingHash,
    ethers.zeroPadValue(ethers.toBeHex(timestamp), 32)
  ];
  
  console.log("    Public Inputs:", publicInputs.length, "elements");
  console.log("    Withdraw amount:", ethers.formatEther(withdrawAmount), "TCRO");

  // First, verify the proof is valid via verifier directly
  console.log("\n[3.5] Testing proof validity via verifier...");
  const isValid = await verifier.verify(zkProof, publicInputs);
  console.log("    Proof valid:", isValid);

  console.log("\n[4] Attempting withdrawal WITH valid ZK proof...");
  
  try {
    const tx3 = await vault.withdraw(proxyAddress, withdrawAmount, zkProof, publicInputs);
    const receipt3 = await tx3.wait();
    
    console.log("    SUCCESS!");
    console.log("    TX Hash:", receipt3.hash);
    console.log("    Gas Used:", receipt3.gasUsed.toString());
    
    const balanceAfter = await vault.getProxyBalance(proxyAddress);
    console.log("    Remaining Balance:", ethers.formatEther(balanceAfter), "TCRO");
    
  } catch (error) {
    console.log("    FAILED:", error.reason || error.message.slice(0, 200));
  }

  console.log("\n[5] Testing INVALID proof (should fail)...");
  
  const fakeProof = ethers.concat([ethers.randomBytes(32), ethers.randomBytes(32)]);
  
  try {
    await vault.withdraw(proxyAddress, ethers.parseEther("0.00001"), fakeProof, publicInputs);
    console.log("    ERROR: Invalid proof accepted!");
  } catch (error) {
    console.log("    REJECTED (correct behavior)");
  }

  console.log("\n" + "=".repeat(70));
  console.log("   WITHDRAWAL TEST COMPLETE");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
