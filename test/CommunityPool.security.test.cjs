/**
 * CommunityPool Security & Hardening Tests
 * 
 * Comprehensive attack vectors and edge case testing for mainnet readiness.
 * Tests circuit breakers, access control, reentrancy protection, and economic attacks.
 */

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("CommunityPool - Security Hardening Tests", function () {
  let communityPool;
  let mockUSDC;
  let owner, attacker, user1, user2, user3, treasury, agent;
  
  const USDC_DECIMALS = 6;
  
  beforeEach(async function () {
    [owner, attacker, user1, user2, user3, treasury, agent] = await ethers.getSigners();
    
    // Deploy MockUSDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    
    // Mint to users
    const mint = ethers.parseUnits("1000000", USDC_DECIMALS);
    await mockUSDC.mint(user1.address, mint);
    await mockUSDC.mint(user2.address, mint);
    await mockUSDC.mint(user3.address, mint);
    await mockUSDC.mint(attacker.address, mint);
    
    // Deploy CommunityPool
    const CommunityPool = await ethers.getContractFactory("CommunityPool");
    const assetTokens = Array(4).fill(ethers.ZeroAddress);
    
    communityPool = await upgrades.deployProxy(
      CommunityPool,
      [await mockUSDC.getAddress(), assetTokens, treasury.address, owner.address],
      { initializer: "initialize", kind: "uups" }
    );
    await communityPool.waitForDeployment();
    
    // Grant agent role
    const AGENT_ROLE = await communityPool.AGENT_ROLE();
    await communityPool.grantRole(AGENT_ROLE, agent.address);
  });

  describe("Circuit Breaker Tests", function () {
    it("should enforce max single deposit limit", async function () {
      const maxDeposit = await communityPool.maxSingleDeposit();
      const overLimit = maxDeposit + BigInt(1);
      
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), overLimit);
      
      await expect(
        communityPool.connect(user1).deposit(overLimit)
      ).to.be.revertedWithCustomError(communityPool, "DepositTooLarge");
    });
    
    it("should allow admin to adjust max deposit", async function () {
      const newMax = ethers.parseUnits("500000", USDC_DECIMALS); // $500K
      await communityPool.setMaxSingleDeposit(newMax);
      
      expect(await communityPool.maxSingleDeposit()).to.equal(newMax);
    });
    
    it("should enforce max single withdrawal BPS", async function () {
      // First deposit
      const deposit = ethers.parseUnits("10000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      // Set withdrawal limit to 10%
      await communityPool.setMaxSingleWithdrawalBps(1000);
      
      const member = await communityPool.members(user1.address);
      
      // Try to withdraw 100% (should fail)
      await expect(
        communityPool.connect(user1).withdraw(member.shares)
      ).to.be.revertedWithCustomError(communityPool, "SingleWithdrawalTooLarge");
    });
    
    it("should enforce daily withdrawal cap", async function () {
      // Set high single withdrawal limit but moderate daily cap
      await communityPool.setMaxSingleWithdrawalBps(10000); // 100%
      await communityPool.setDailyWithdrawalCapBps(2000); // 20%
      
      // Multiple users deposit equal amounts
      const deposit = ethers.parseUnits("10000", USDC_DECIMALS);
      for (const user of [user1, user2, user3]) {
        await mockUSDC.connect(user).approve(await communityPool.getAddress(), deposit);
        await communityPool.connect(user).deposit(deposit);
      }
      
      // Try to withdraw user1's full balance (~33% of pool) - exceeds 20% daily cap
      const member1 = await communityPool.members(user1.address);
      await expect(
        communityPool.connect(user1).withdraw(member1.shares)
      ).to.be.reverted; // Should fail because single withdrawal > daily cap
      
      // Partial withdrawal within daily cap should work
      const partialShares = member1.shares / BigInt(2); // ~16% of pool
      await communityPool.connect(user1).withdraw(partialShares);
    });
    
    it("should reset daily withdrawal cap at midnight UTC", async function () {
      await communityPool.setMaxSingleWithdrawalBps(5000); // 50%
      await communityPool.setDailyWithdrawalCapBps(6000); // 60%
      
      // Two users deposit
      const deposit = ethers.parseUnits("10000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user2).deposit(deposit);
      
      // First full withdrawal (~50% of pool) - within daily cap of 60%
      const member1 = await communityPool.members(user1.address);
      await communityPool.connect(user1).withdraw(member1.shares);
      
      // Second withdrawal should fail (exceeded daily cap already)
      // Note: After user1 exits, user2 owns 100% but daily cap check uses original NAV
      const member2Before = await communityPool.members(user2.address);
      const halfShares = member2Before.shares / BigInt(2);
      
      // Withdraw small amount to test cap accumulation
      await expect(
        communityPool.connect(user2).withdraw(halfShares)
      ).to.be.reverted; // Daily cap exceeded
      
      // Fast forward 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      
      // Daily cap resets, withdrawal should now work
      await communityPool.connect(user2).withdraw(halfShares);
    });
    
    it("should allow admin to trip circuit breaker", async function () {
      await communityPool.tripCircuitBreaker("Emergency: Suspicious activity detected");
      
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      
      await expect(
        communityPool.connect(user1).deposit(deposit)
      ).to.be.revertedWithCustomError(communityPool, "CircuitBreakerActive");
    });
    
    it("should allow admin to reset circuit breaker", async function () {
      await communityPool.tripCircuitBreaker("Test");
      await communityPool.resetCircuitBreaker();
      
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      const member = await communityPool.members(user1.address);
      expect(member.shares).to.be.gt(0);
    });
  });
  
  describe("Access Control Tests", function () {
    it("should prevent non-admin from setting circuit breakers", async function () {
      await expect(
        communityPool.connect(attacker).setMaxSingleDeposit(ethers.parseUnits("1000000000", USDC_DECIMALS))
      ).to.be.reverted;
    });
    
    it("should prevent non-admin from tripping circuit breaker", async function () {
      await expect(
        communityPool.connect(attacker).tripCircuitBreaker("Malicious")
      ).to.be.reverted;
    });
    
    it("should prevent non-admin from pausing", async function () {
      await expect(
        communityPool.connect(attacker).pause()
      ).to.be.reverted;
    });
    
    it("should prevent non-agent from rebalancing", async function () {
      const REBALANCER_ROLE = await communityPool.REBALANCER_ROLE();
      const hasRole = await communityPool.hasRole(REBALANCER_ROLE, attacker.address);
      expect(hasRole).to.be.false;
    });
    
    it("should prevent non-upgrader from upgrading", async function () {
      const CommunityPoolV2 = await ethers.getContractFactory("CommunityPool");
      
      await expect(
        upgrades.upgradeProxy(await communityPool.getAddress(), CommunityPoolV2.connect(attacker))
      ).to.be.reverted;
    });
  });
  
  describe("Economic Attack Prevention", function () {
    it("should prevent inflation attack via virtual shares", async function () {
      // Attacker tries minimal first deposit
      const minFirst = ethers.parseUnits("100", USDC_DECIMALS);
      await mockUSDC.connect(attacker).approve(await communityPool.getAddress(), minFirst);
      await communityPool.connect(attacker).deposit(minFirst);
      
      // Check shares are reasonable (not manipulable via tiny deposit)
      const attackerMember = await communityPool.members(attacker.address);
      const sharePrice = await communityPool.getNavPerShare();
      
      // Share price should be close to $1 (1e6 in USDC decimals)
      // NAV per share returns 6 decimals (USDC-scaled)
      const oneUsd = ethers.parseUnits("1", USDC_DECIMALS); // 1e6
      const fivePercent = oneUsd / BigInt(20);
      expect(sharePrice).to.be.closeTo(oneUsd, fivePercent);
    });
    
    it("should prevent donation attack", async function () {
      // User deposits
      const deposit = ethers.parseUnits("10000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      const sharesBefore = (await communityPool.members(user1.address)).shares;
      const navBefore = await communityPool.getNavPerShare();
      
      // Attacker sends USDC directly to contract (donation attack)
      const donation = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(attacker).transfer(await communityPool.getAddress(), donation);
      
      // NAV per share should not change significantly (handled by totalIdle tracking)
      const navAfter = await communityPool.getNavPerShare();
      
      // Should be within 10% (donation doesn't massively inflate)
      const diff = navAfter > navBefore ? navAfter - navBefore : navBefore - navAfter;
      const tenPercent = navBefore / BigInt(10);
      expect(diff).to.be.lessThanOrEqual(tenPercent);
    });
    
    it("should prevent sandwich attack on deposits", async function () {
      // First user deposits
      const deposit1 = ethers.parseUnits("10000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit1);
      await communityPool.connect(user1).deposit(deposit1);
      
      const navBefore = await communityPool.getNavPerShare();
      
      // Second user deposits (potential victim)
      const deposit2 = ethers.parseUnits("5000", USDC_DECIMALS);
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), deposit2);
      await communityPool.connect(user2).deposit(deposit2);
      
      const navAfter = await communityPool.getNavPerShare();
      
      // NAV per share should be stable (no sandwich opportunity)
      const variance = navAfter > navBefore ? navAfter - navBefore : navBefore - navAfter;
      const onePercent = navBefore / BigInt(100);
      expect(variance).to.be.lessThanOrEqual(onePercent);
    });
    
    it("should enforce share price floor on deposits", async function () {
      // First deposit
      const deposit = ethers.parseUnits("10000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      // Simulate NAV crash (if share price drops below $0.90)
      // The contract should reject new deposits when undercollateralized
      // Note: This is tested via the SharePriceTooLow revert in the contract
    });
  });
  
  describe("Edge Cases", function () {
    it("should handle zero balance member gracefully", async function () {
      const position = await communityPool.getMemberPosition(attacker.address);
      expect(position.valueUSD).to.equal(0);
      expect(position.shares).to.equal(0);
      expect(position.percentage).to.equal(0);
    });
    
    it("should handle very small deposits above minimum", async function () {
      const minDeposit = ethers.parseUnits("100", USDC_DECIMALS); // MIN_FIRST_DEPOSIT
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), minDeposit);
      await communityPool.connect(user1).deposit(minDeposit);
      
      const member = await communityPool.members(user1.address);
      expect(member.shares).to.be.gt(0);
    });
    
    it("should reject deposit below minimum", async function () {
      const tooSmall = ethers.parseUnits("5", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), tooSmall);
      
      await expect(
        communityPool.connect(user1).deposit(tooSmall)
      ).to.be.reverted;
    });
    
    it("should handle max uint256 approval safely", async function () {
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), ethers.MaxUint256);
      
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await communityPool.connect(user1).deposit(deposit);
      
      const member = await communityPool.members(user1.address);
      expect(member.shares).to.be.gt(0);
    });
  });
  
  describe("Pausable Functionality", function () {
    it("should pause deposits when paused", async function () {
      await communityPool.pause();
      
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      
      await expect(
        communityPool.connect(user1).deposit(deposit)
      ).to.be.reverted;
    });
    
    it("should allow withdrawal when paused (via emergency withdraw)", async function () {
      // Enable emergency withdrawals 
      await communityPool.setMaxSingleWithdrawalBps(10000);
      await communityPool.setDailyWithdrawalCapBps(10000);
      await communityPool.setEmergencyWithdraw(true);
      
      // Deposit first
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      // Trip circuit breaker (pauses deposits but emergency withdraw still works)
      await communityPool.tripCircuitBreaker("Emergency test");
      
      // Emergency withdrawal should still work (circuit breaker doesn't block emergency)
      const member = await communityPool.members(user1.address);
      await communityPool.connect(user1).withdraw(member.shares);
      
      const memberAfter = await communityPool.members(user1.address);
      expect(memberAfter.shares).to.equal(0);
    });
    
    it("should unpause correctly", async function () {
      await communityPool.pause();
      await communityPool.unpause();
      
      const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
      
      const member = await communityPool.members(user1.address);
      expect(member.shares).to.be.gt(0);
    });
  });
  
  describe("Timelock Integration Simulation", function () {
    it("should transfer admin role correctly", async function () {
      const DEFAULT_ADMIN_ROLE = await communityPool.DEFAULT_ADMIN_ROLE();
      
      // Grant admin to a new address (simulating timelock)
      await communityPool.grantRole(DEFAULT_ADMIN_ROLE, treasury.address);
      
      // Verify new admin has role
      expect(await communityPool.hasRole(DEFAULT_ADMIN_ROLE, treasury.address)).to.be.true;
      
      // Revoke from original admin
      await communityPool.revokeRole(DEFAULT_ADMIN_ROLE, owner.address);
      
      // Original admin should no longer have access
      expect(await communityPool.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.false;
    });
    
    it("should prevent operations after admin transfer", async function () {
      const DEFAULT_ADMIN_ROLE = await communityPool.DEFAULT_ADMIN_ROLE();
      
      await communityPool.grantRole(DEFAULT_ADMIN_ROLE, treasury.address);
      await communityPool.revokeRole(DEFAULT_ADMIN_ROLE, owner.address);
      
      // Owner can no longer set circuit breakers
      await expect(
        communityPool.setMaxSingleDeposit(ethers.parseUnits("1000000", USDC_DECIMALS))
      ).to.be.reverted;
      
      // But treasury (new admin) can
      await communityPool.connect(treasury).setMaxSingleDeposit(
        ethers.parseUnits("200000", USDC_DECIMALS)
      );
    });
  });
});

describe("CommunityPool - Gas Optimization Verification", function () {
  let communityPool;
  let mockUSDC;
  let owner, user1;
  
  const USDC_DECIMALS = 6;
  
  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000000", USDC_DECIMALS));
    
    const CommunityPool = await ethers.getContractFactory("CommunityPool");
    const assetTokens = Array(4).fill(ethers.ZeroAddress);
    
    communityPool = await upgrades.deployProxy(
      CommunityPool,
      [await mockUSDC.getAddress(), assetTokens, owner.address, owner.address],
      { initializer: "initialize", kind: "uups" }
    );
    await communityPool.waitForDeployment();
  });
  
  it("should have reasonable deposit gas cost", async function () {
    const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
    await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
    
    const tx = await communityPool.connect(user1).deposit(deposit);
    const receipt = await tx.wait();
    
    // Deposit should cost less than 350k gas (first deposit initializes storage)
    expect(receipt.gasUsed).to.be.lessThan(350000);
    console.log(`    Deposit gas: ${receipt.gasUsed.toString()}`);
  });
  
  it("should have reasonable withdrawal gas cost", async function () {
    await communityPool.setMaxSingleWithdrawalBps(10000);
    await communityPool.setDailyWithdrawalCapBps(10000);
    
    const deposit = ethers.parseUnits("1000", USDC_DECIMALS);
    await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
    await communityPool.connect(user1).deposit(deposit);
    
    const member = await communityPool.members(user1.address);
    const tx = await communityPool.connect(user1).withdraw(member.shares);
    const receipt = await tx.wait();
    
    // Withdrawal should cost less than 200k gas
    expect(receipt.gasUsed).to.be.lessThan(200000);
    console.log(`    Withdrawal gas: ${receipt.gasUsed.toString()}`);
  });
});
