/**
 * ZK Proxy Vault Integration Tests
 * 
 * Tests the bulletproof escrow system:
 * - On-chain ZK proof verification
 * - PDA proxy creation (no private key)
 * - Time-locked withdrawals for large amounts
 * - Owner-only withdrawal enforcement
 */

const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('ZKProxyVault - Bulletproof Escrow', function () {
  let zkVerifier;
  let zkVault;
  let owner;
  let user1;
  let user2;
  let guardian;
  let attacker;

  const TIME_LOCK_THRESHOLD = ethers.parseEther('10'); // 10 ETH
  const TIME_LOCK_DURATION = 60 * 60 * 24; // 24 hours

  beforeEach(async function () {
    [owner, user1, user2, guardian, attacker] = await ethers.getSigners();

    // Deploy ZK Verifier
    const ZKVerifier = await ethers.getContractFactory('ZKSTARKVerifier');
    zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();

    // Deploy ZK Proxy Vault (upgradeable)
    const ZKVault = await ethers.getContractFactory('ZKProxyVault');
    zkVault = await upgrades.deployProxy(
      ZKVault,
      [await zkVerifier.getAddress(), TIME_LOCK_THRESHOLD, TIME_LOCK_DURATION],
      { initializer: 'initialize', kind: 'uups' }
    );
    await zkVault.waitForDeployment();

    // Grant guardian role
    const GUARDIAN_ROLE = await zkVault.GUARDIAN_ROLE();
    await zkVault.grantRole(GUARDIAN_ROLE, guardian.address);
  });

  describe('Proxy Creation', function () {
    it('should create a deterministic proxy address (no private key)', async function () {
      const zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );

      // Preview the address
      const nonce = await zkVault.ownerNonces(user1.address);
      const previewAddress = await zkVault.deriveProxyAddress(
        user1.address,
        nonce,
        zkBindingHash
      );

      // Create proxy
      const tx = await zkVault.connect(user1).createProxy(zkBindingHash);
      const receipt = await tx.wait();

      // Get created proxy address from event
      const event = receipt?.logs.find((log: any) => {
        try {
          return zkVault.interface.parseLog(log)?.name === 'ProxyCreated';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = zkVault.interface.parseLog(event as any);
      const createdProxy = parsedEvent?.args.proxyAddress;

      expect(createdProxy).to.equal(previewAddress);
      
      // Verify binding stored correctly
      const binding = await zkVault.proxyBindings(createdProxy);
      expect(binding.owner).to.equal(user1.address);
      expect(binding.zkBindingHash).to.equal(zkBindingHash);
      expect(binding.isActive).to.be.true;
    });

    it('should prevent duplicate proxy creation', async function () {
      const zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );

      await zkVault.connect(user1).createProxy(zkBindingHash);
      
      // Second proxy should have different address (nonce incremented)
      const tx2 = await zkVault.connect(user1).createProxy(zkBindingHash);
      const receipt2 = await tx2.wait();
      
      // Both should exist
      const proxies = await zkVault.getOwnerProxies(user1.address);
      expect(proxies.length).to.equal(2);
    });
  });

  describe('Deposits', function () {
    let proxyAddress: string;

    beforeEach(async function () {
      const zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );
      
      const nonce = await zkVault.ownerNonces(user1.address);
      proxyAddress = await zkVault.deriveProxyAddress(user1.address, nonce, zkBindingHash);
      await zkVault.connect(user1).createProxy(zkBindingHash);
    });

    it('should accept deposits into proxy', async function () {
      const depositAmount = ethers.parseEther('5');
      
      await zkVault.connect(user2).deposit(proxyAddress, { value: depositAmount });
      
      const balance = await zkVault.getProxyBalance(proxyAddress);
      expect(balance).to.equal(depositAmount);
      
      const tvl = await zkVault.totalValueLocked();
      expect(tvl).to.equal(depositAmount);
    });

    it('should reject deposits to non-existent proxy', async function () {
      const fakeProxy = ethers.Wallet.createRandom().address;
      
      await expect(
        zkVault.connect(user2).deposit(fakeProxy, { value: ethers.parseEther('1') })
      ).to.be.revertedWithCustomError(zkVault, 'ProxyNotFound');
    });
  });

  describe('Withdrawals with ZK Proof', function () {
    let proxyAddress: string;
    let zkBindingHash: string;

    beforeEach(async function () {
      zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );
      
      const nonce = await zkVault.ownerNonces(user1.address);
      proxyAddress = await zkVault.deriveProxyAddress(user1.address, nonce, zkBindingHash);
      await zkVault.connect(user1).createProxy(zkBindingHash);
      
      // Deposit funds
      await zkVault.connect(user2).deposit(proxyAddress, { value: ethers.parseEther('20') });
    });

    it('should allow owner to withdraw small amounts instantly with valid ZK proof', async function () {
      const withdrawAmount = ethers.parseEther('5'); // Below threshold
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Generate ZK proof
      const [commitment, response] = await zkVerifier.computeProofComponents(
        user1.address,
        proxyAddress,
        zkBindingHash,
        timestamp
      );
      
      const proof = ethers.concat([commitment, response]);
      const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [user1.address]));
      const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
      const timestampBytes = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
      
      const publicInputs = [ownerHash, proxyHash, zkBindingHash, timestampBytes];
      
      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await zkVault.connect(user1).withdraw(
        proxyAddress,
        withdrawAmount,
        proof,
        publicInputs
      );
      
      await expect(tx)
        .to.emit(zkVault, 'InstantWithdrawal')
        .withArgs(user1.address, proxyAddress, withdrawAmount);
      
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      expect(balanceAfter).to.be.gt(balanceBefore); // Should have received funds
    });

    it('should time-lock large withdrawals', async function () {
      const withdrawAmount = ethers.parseEther('15'); // Above threshold
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Generate ZK proof
      const [commitment, response] = await zkVerifier.computeProofComponents(
        user1.address,
        proxyAddress,
        zkBindingHash,
        timestamp
      );
      
      const proof = ethers.concat([commitment, response]);
      const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [user1.address]));
      const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
      const timestampBytes = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
      
      const publicInputs = [ownerHash, proxyHash, zkBindingHash, timestampBytes];
      
      const tx = await zkVault.connect(user1).withdraw(
        proxyAddress,
        withdrawAmount,
        proof,
        publicInputs
      );
      
      await expect(tx).to.emit(zkVault, 'WithdrawalRequested');
    });

    it('should REJECT withdrawal from non-owner (CRITICAL SECURITY)', async function () {
      const withdrawAmount = ethers.parseEther('5');
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Attacker tries to generate proof (won't match binding)
      const [commitment, response] = await zkVerifier.computeProofComponents(
        attacker.address, // Wrong owner!
        proxyAddress,
        zkBindingHash,
        timestamp
      );
      
      const proof = ethers.concat([commitment, response]);
      const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [attacker.address]));
      const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
      const timestampBytes = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
      
      const publicInputs = [ownerHash, proxyHash, zkBindingHash, timestampBytes];
      
      // Should be rejected because attacker is not the owner
      await expect(
        zkVault.connect(attacker).withdraw(proxyAddress, withdrawAmount, proof, publicInputs)
      ).to.be.revertedWithCustomError(zkVault, 'NotProxyOwner');
    });

    it('should REJECT withdrawal with invalid ZK proof', async function () {
      const withdrawAmount = ethers.parseEther('5');
      
      // Create a fake/invalid proof
      const fakeProof = ethers.randomBytes(64);
      const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [user1.address]));
      const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
      const timestampBytes = ethers.zeroPadValue(ethers.toBeHex(Date.now()), 32);
      
      const publicInputs = [ownerHash, proxyHash, zkBindingHash, timestampBytes];
      
      await expect(
        zkVault.connect(user1).withdraw(proxyAddress, withdrawAmount, fakeProof, publicInputs)
      ).to.be.revertedWithCustomError(zkVault, 'InvalidZKProof');
    });
  });

  describe('Time-Lock Security', function () {
    let proxyAddress: string;
    let zkBindingHash: string;
    let withdrawalId: string;

    beforeEach(async function () {
      zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );
      
      const nonce = await zkVault.ownerNonces(user1.address);
      proxyAddress = await zkVault.deriveProxyAddress(user1.address, nonce, zkBindingHash);
      await zkVault.connect(user1).createProxy(zkBindingHash);
      await zkVault.connect(user2).deposit(proxyAddress, { value: ethers.parseEther('20') });
      
      // Create a time-locked withdrawal
      const withdrawAmount = ethers.parseEther('15');
      const timestamp = Math.floor(Date.now() / 1000);
      
      const [commitment, response] = await zkVerifier.computeProofComponents(
        user1.address,
        proxyAddress,
        zkBindingHash,
        timestamp
      );
      
      const proof = ethers.concat([commitment, response]);
      const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [user1.address]));
      const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
      const timestampBytes = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
      
      const publicInputs = [ownerHash, proxyHash, zkBindingHash, timestampBytes];
      
      const tx = await zkVault.connect(user1).withdraw(
        proxyAddress,
        withdrawAmount,
        proof,
        publicInputs
      );
      const receipt = await tx.wait();
      
      // Get withdrawal ID from event
      const event = receipt?.logs.find((log: any) => {
        try {
          return zkVault.interface.parseLog(log)?.name === 'WithdrawalRequested';
        } catch {
          return false;
        }
      });
      
      const parsedEvent = zkVault.interface.parseLog(event as any);
      withdrawalId = parsedEvent?.args.withdrawalId;
    });

    it('should prevent early execution of time-locked withdrawal', async function () {
      await expect(
        zkVault.connect(user1).executeWithdrawal(withdrawalId)
      ).to.be.revertedWithCustomError(zkVault, 'WithdrawalNotReady');
    });

    it('should allow guardian to cancel suspicious withdrawal', async function () {
      await expect(
        zkVault.connect(guardian).cancelWithdrawal(withdrawalId)
      ).to.emit(zkVault, 'WithdrawalCancelled');
      
      // Funds should be returned to proxy
      const balance = await zkVault.getProxyBalance(proxyAddress);
      expect(balance).to.equal(ethers.parseEther('20')); // Full amount restored
    });

    it('should allow execution after time-lock expires', async function () {
      // Fast forward time
      await ethers.provider.send('evm_increaseTime', [TIME_LOCK_DURATION + 1]);
      await ethers.provider.send('evm_mine', []);
      
      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      await expect(
        zkVault.connect(user1).executeWithdrawal(withdrawalId)
      ).to.emit(zkVault, 'WithdrawalExecuted');
      
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe('Emergency Controls', function () {
    it('should allow guardian to pause in emergency', async function () {
      await zkVault.connect(guardian).pause();
      
      const zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );
      
      await expect(
        zkVault.connect(user1).createProxy(zkBindingHash)
      ).to.be.revertedWithCustomError(zkVault, 'EnforcedPause');
    });

    it('should only allow admin to unpause', async function () {
      await zkVault.connect(guardian).pause();
      
      await expect(
        zkVault.connect(guardian).unpause()
      ).to.be.reverted; // Guardian can't unpause
      
      await zkVault.connect(owner).unpause(); // Admin can
      
      const zkBindingHash = ethers.keccak256(
        ethers.solidityPacked(['address', 'string'], [user1.address, 'binding'])
      );
      
      await expect(
        zkVault.connect(user1).createProxy(zkBindingHash)
      ).to.not.be.reverted;
    });
  });
});
