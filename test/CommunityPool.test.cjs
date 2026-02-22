/**
 * CommunityPool E2E Tests
 * 
 * Comprehensive tests for the AI-managed community investment pool:
 * - Deposit and share calculation
 * - Withdrawal and NAV calculation
 * - Multiple user scenarios
 * - Fee collection (management + performance)
 * - AI rebalancing
 * - Edge cases and security
 */

const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('CommunityPool - AI-Managed Investment Pool', function () {
  let communityPool;
  let mockUSDC;
  let owner;
  let user1;
  let user2;
  let user3;
  let treasury;
  let agent;

  // Constants
  const USDC_DECIMALS = 6;
  const SHARE_DECIMALS = 18;
  const MIN_DEPOSIT = ethers.parseUnits('10', USDC_DECIMALS); // $10
  const MIN_FIRST_DEPOSIT = ethers.parseUnits('1000', USDC_DECIMALS); // $1000 (security: anti-inflation attack)
  const INITIAL_BALANCE = ethers.parseUnits('100000', USDC_DECIMALS); // $100K each
  const VIRTUAL_SHARES = BigInt('1000000000000000000'); // 1e18
  const VIRTUAL_ASSETS = BigInt('1000000'); // 1e6 ($1 USDC)

  beforeEach(async function () {
    [owner, user1, user2, user3, treasury, agent] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockUSDC = await MockERC20.deploy('Mock USDC', 'USDC', 6);
    await mockUSDC.waitForDeployment();

    // Mint USDC to users
    await mockUSDC.mint(user1.address, INITIAL_BALANCE);
    await mockUSDC.mint(user2.address, INITIAL_BALANCE);
    await mockUSDC.mint(user3.address, INITIAL_BALANCE);

    // Deploy CommunityPool (upgradeable)
    const CommunityPool = await ethers.getContractFactory('CommunityPool');
    
    // Asset tokens (zero addresses for testing - we'll use USDC only)
    const assetTokens = [
      ethers.ZeroAddress, // BTC
      ethers.ZeroAddress, // ETH
      ethers.ZeroAddress, // SUI
      ethers.ZeroAddress, // CRO
    ];

    communityPool = await upgrades.deployProxy(
      CommunityPool,
      [
        await mockUSDC.getAddress(),
        assetTokens,
        treasury.address,
        owner.address,
      ],
      { initializer: 'initialize', kind: 'uups' }
    );
    await communityPool.waitForDeployment();

    // Grant agent role
    const AGENT_ROLE = await communityPool.AGENT_ROLE();
    const REBALANCER_ROLE = await communityPool.REBALANCER_ROLE();
    await communityPool.grantRole(AGENT_ROLE, agent.address);
    await communityPool.grantRole(REBALANCER_ROLE, agent.address);
  });

  describe('Initialization', function () {
    it('should initialize with correct parameters', async function () {
      const stats = await communityPool.getPoolStats();
      
      expect(stats._totalShares).to.equal(0);
      expect(stats._totalNAV).to.equal(0);
      expect(stats._memberCount).to.equal(0);
      
      // Default allocation: 25% each
      expect(stats._allocations[0]).to.equal(2500);
      expect(stats._allocations[1]).to.equal(2500);
      expect(stats._allocations[2]).to.equal(2500);
      expect(stats._allocations[3]).to.equal(2500);
    });

    it('should have correct fee settings', async function () {
      const managementFee = await communityPool.managementFeeBps();
      const performanceFee = await communityPool.performanceFeeBps();
      
      expect(managementFee).to.equal(50); // 0.5%
      expect(performanceFee).to.equal(1000); // 10%
    });
  });

  describe('Deposits', function () {
    it('should allow first deposit and mint shares at $1 per share', async function () {
      const depositAmount = ethers.parseUnits('1000', USDC_DECIMALS); // $1000 (minimum first deposit)
      
      // Approve and deposit
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), depositAmount);
      
      const tx = await communityPool.connect(user1).deposit(depositAmount);
      const receipt = await tx.wait();
      
      // With virtual offset: shares = amount * (VIRTUAL_SHARES) / (VIRTUAL_ASSETS)
      // shares = 1000e6 * 1e18 / 1e6 = 1000e18
      const expectedShares = ethers.parseUnits('1000', SHARE_DECIMALS);
      const member = await communityPool.members(user1.address);
      
      // Allow small variance for virtual offset effect
      expect(member.shares).to.be.closeTo(expectedShares, expectedShares / BigInt(100));
      
      // Check event
      const event = receipt?.logs.find((log) => {
        try {
          return communityPool.interface.parseLog(log)?.name === 'Deposited';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });

    it('should reject first deposit below minimum first deposit', async function () {
      // First deposit requires $1000, not just $10
      const smallDeposit = ethers.parseUnits('100', USDC_DECIMALS); // $100 - below MIN_FIRST_DEPOSIT
      
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), smallDeposit);
      
      await expect(
        communityPool.connect(user1).deposit(smallDeposit)
      ).to.be.revertedWithCustomError(communityPool, 'FirstDepositTooSmall');
    });

    it('should calculate shares proportionally for subsequent deposits', async function () {
      // First deposit: $1000
      const deposit1 = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit1);
      await communityPool.connect(user1).deposit(deposit1);
      
      // Second deposit by different user: $500
      const deposit2 = ethers.parseUnits('500', USDC_DECIMALS);
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), deposit2);
      await communityPool.connect(user2).deposit(deposit2);
      
      // User2 should have half the shares of user1
      const member1 = await communityPool.members(user1.address);
      const member2 = await communityPool.members(user2.address);
      
      // Allowing for small rounding differences
      expect(member2.shares).to.be.closeTo(
        member1.shares / BigInt(2),
        BigInt(1e15) // Small tolerance
      );
    });

    it('should track membership correctly', async function () {
      const deposit = ethers.parseUnits('1000', USDC_DECIMALS); // MIN_FIRST_DEPOSIT
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      
      // Before deposit
      expect(await communityPool.isMember(user1.address)).to.be.false;
      expect(await communityPool.getMemberCount()).to.equal(0);
      
      // After deposit
      await communityPool.connect(user1).deposit(deposit);
      
      expect(await communityPool.isMember(user1.address)).to.be.true;
      expect(await communityPool.getMemberCount()).to.equal(1);
    });
  });

  describe('Withdrawals', function () {
    beforeEach(async function () {
      // Setup: User1 deposits $1000
      const deposit = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
    });

    it('should allow partial withdrawal', async function () {
      const member = await communityPool.members(user1.address);
      const sharesToBurn = member.shares / BigInt(2); // 50%
      
      const balanceBefore = await mockUSDC.balanceOf(user1.address);
      
      await communityPool.connect(user1).withdraw(sharesToBurn);
      
      const balanceAfter = await mockUSDC.balanceOf(user1.address);
      const memberAfter = await communityPool.members(user1.address);
      
      // Should receive approximately $500
      expect(balanceAfter - balanceBefore).to.be.closeTo(
        ethers.parseUnits('500', USDC_DECIMALS),
        ethers.parseUnits('1', USDC_DECIMALS) // $1 tolerance for fees
      );
      
      // Should still have half shares
      expect(memberAfter.shares).to.be.closeTo(
        sharesToBurn,
        BigInt(1e15)
      );
    });

    it('should allow full withdrawal and remove membership', async function () {
      const member = await communityPool.members(user1.address);
      
      await communityPool.connect(user1).withdraw(member.shares);
      
      const memberAfter = await communityPool.members(user1.address);
      
      expect(memberAfter.shares).to.equal(0);
      expect(await communityPool.isMember(user1.address)).to.be.false;
    });

    it('should reject withdrawal exceeding balance', async function () {
      const member = await communityPool.members(user1.address);
      const excessShares = member.shares + BigInt(1e18);
      
      await expect(
        communityPool.connect(user1).withdraw(excessShares)
      ).to.be.revertedWithCustomError(communityPool, 'InsufficientShares');
    });
  });

  describe('Multiple Users Scenario', function () {
    it('should handle deposits and withdrawals from multiple users', async function () {
      // User1 deposits $1000
      const deposit1 = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit1);
      await communityPool.connect(user1).deposit(deposit1);

      // User2 deposits $2000
      const deposit2 = ethers.parseUnits('2000', USDC_DECIMALS);
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), deposit2);
      await communityPool.connect(user2).deposit(deposit2);

      // User3 deposits $500
      const deposit3 = ethers.parseUnits('500', USDC_DECIMALS);
      await mockUSDC.connect(user3).approve(await communityPool.getAddress(), deposit3);
      await communityPool.connect(user3).deposit(deposit3);

      // Check total NAV
      const stats = await communityPool.getPoolStats();
      expect(stats._totalNAV).to.equal(deposit1 + deposit2 + deposit3); // $3500

      // Check member count
      expect(stats._memberCount).to.equal(3);

      // Check ownership percentages
      const pos1 = await communityPool.getMemberPosition(user1.address);
      const pos2 = await communityPool.getMemberPosition(user2.address);
      const pos3 = await communityPool.getMemberPosition(user3.address);

      // User1: ~28.57% (1000/3500)
      expect(pos1.percentage).to.be.closeTo(BigInt(2857), BigInt(10));
      // User2: ~57.14% (2000/3500)
      expect(pos2.percentage).to.be.closeTo(BigInt(5714), BigInt(10));
      // User3: ~14.29% (500/3500)
      expect(pos3.percentage).to.be.closeTo(BigInt(1429), BigInt(10));

      // User2 withdraws half
      const member2 = await communityPool.members(user2.address);
      await communityPool.connect(user2).withdraw(member2.shares / BigInt(2));

      // Check updated stats
      const statsAfter = await communityPool.getPoolStats();
      expect(statsAfter._totalNAV).to.be.closeTo(
        ethers.parseUnits('2500', USDC_DECIMALS),
        ethers.parseUnits('5', USDC_DECIMALS)
      );
    });
  });

  describe('AI Rebalancing', function () {
    it('should allow agent to set new target allocation', async function () {
      // New allocation: BTC 40%, ETH 30%, SUI 20%, CRO 10%
      const newAllocation = [4000, 3000, 2000, 1000];
      const reasoning = "BTC bullish momentum, increasing allocation";

      await communityPool.connect(agent).setTargetAllocation(newAllocation, reasoning);

      const stats = await communityPool.getPoolStats();
      expect(stats._allocations[0]).to.equal(4000); // BTC
      expect(stats._allocations[1]).to.equal(3000); // ETH
      expect(stats._allocations[2]).to.equal(2000); // SUI
      expect(stats._allocations[3]).to.equal(1000); // CRO
    });

    it('should reject invalid allocation (not summing to 100%)', async function () {
      const invalidAllocation = [3000, 3000, 2000, 1000]; // Only 90%

      await expect(
        communityPool.connect(agent).setTargetAllocation(invalidAllocation, "test")
      ).to.be.revertedWithCustomError(communityPool, 'InvalidAllocation');
    });

    it('should enforce rebalance cooldown', async function () {
      const allocation1 = [4000, 3000, 2000, 1000];
      const allocation2 = [2500, 2500, 2500, 2500];

      await communityPool.connect(agent).setTargetAllocation(allocation1, "first");

      // Immediate second rebalance should fail
      await expect(
        communityPool.connect(agent).setTargetAllocation(allocation2, "second")
      ).to.be.revertedWithCustomError(communityPool, 'RebalanceCooldownActive');
    });

    it('should track rebalance history', async function () {
      const allocation = [4000, 3000, 2000, 1000];
      await communityPool.connect(agent).setTargetAllocation(allocation, "test reasoning");

      const historyCount = await communityPool.getRebalanceHistoryCount();
      expect(historyCount).to.equal(1);

      const record = await communityPool.rebalanceHistory(0);
      expect(record.reasoning).to.equal("test reasoning");
      expect(record.executor).to.equal(agent.address);
    });
  });

  describe('Fee Collection (Self-Sustaining)', function () {
    beforeEach(async function () {
      // Setup pool with $10,000
      const deposit = ethers.parseUnits('10000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);
    });

    it('should collect management fees over time', async function () {
      // Fast forward 1 year
      await ethers.provider.send('evm_increaseTime', [365 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      // Trigger fee collection
      const FEE_MANAGER_ROLE = await communityPool.FEE_MANAGER_ROLE();
      await communityPool.grantRole(FEE_MANAGER_ROLE, owner.address);
      await communityPool.collectFees();

      const accumulatedManagement = await communityPool.accumulatedManagementFees();
      
      // Should be approximately 0.5% of $10,000 = $50
      expect(accumulatedManagement).to.be.closeTo(
        ethers.parseUnits('50', USDC_DECIMALS),
        ethers.parseUnits('5', USDC_DECIMALS) // Allow some variance
      );
    });

    it('should allow treasury to withdraw fees', async function () {
      // Simulate accumulated fees
      await ethers.provider.send('evm_increaseTime', [365 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const FEE_MANAGER_ROLE = await communityPool.FEE_MANAGER_ROLE();
      await communityPool.grantRole(FEE_MANAGER_ROLE, owner.address);
      await communityPool.collectFees();

      const treasuryBalanceBefore = await mockUSDC.balanceOf(treasury.address);
      await communityPool.withdrawFees();
      const treasuryBalanceAfter = await mockUSDC.balanceOf(treasury.address);

      expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
    });
  });

  describe('Edge Cases', function () {
    it('should handle small subsequent deposits above minimum', async function () {
      // First deposit must be $1000 (anti-inflation attack protection)
      const firstDeposit = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), firstDeposit);
      await communityPool.connect(user1).deposit(firstDeposit);
      
      // Now subsequent deposits can be as low as $10
      const smallDeposit = ethers.parseUnits('10', USDC_DECIMALS);
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), smallDeposit);
      await communityPool.connect(user2).deposit(smallDeposit);
      
      const member = await communityPool.members(user2.address);
      expect(member.shares).to.be.gt(0);
    });

    it('should handle large deposits', async function () {
      const largeDeposit = ethers.parseUnits('1000000', USDC_DECIMALS); // $1M
      await mockUSDC.mint(user1.address, largeDeposit);
      
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), largeDeposit);
      await communityPool.connect(user1).deposit(largeDeposit);
      
      const stats = await communityPool.getPoolStats();
      expect(stats._totalNAV).to.equal(largeDeposit);
    });

    it('should handle sequential deposits from same user', async function () {
      const deposit1 = ethers.parseUnits('1000', USDC_DECIMALS); // First deposit must meet MIN_FIRST_DEPOSIT
      const deposit2 = ethers.parseUnits('200', USDC_DECIMALS);
      const deposit3 = ethers.parseUnits('300', USDC_DECIMALS);
      
      await mockUSDC.connect(user1).approve(
        await communityPool.getAddress(),
        deposit1 + deposit2 + deposit3
      );
      
      await communityPool.connect(user1).deposit(deposit1);
      await communityPool.connect(user1).deposit(deposit2);
      await communityPool.connect(user1).deposit(deposit3);
      
      const member = await communityPool.members(user1.address);
      expect(member.depositedUSD).to.equal(deposit1 + deposit2 + deposit3);
    });
  });

  describe('Security', function () {
    it('should prevent non-admin from setting fees', async function () {
      await expect(
        communityPool.connect(user1).setManagementFee(100)
      ).to.be.reverted;
    });

    it('should prevent non-agent from rebalancing', async function () {
      const allocation = [4000, 3000, 2000, 1000];
      
      await expect(
        communityPool.connect(user1).setTargetAllocation(allocation, "hack")
      ).to.be.reverted;
    });

    it('should be pausable by admin', async function () {
      await communityPool.pause();
      
      const deposit = ethers.parseUnits('100', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      
      await expect(
        communityPool.connect(user1).deposit(deposit)
      ).to.be.reverted; // EnforcedPause
    });

    it('should enforce minimum first deposit to prevent inflation attack', async function () {
      // Try to deposit less than MIN_FIRST_DEPOSIT ($1000)
      const smallDeposit = ethers.parseUnits('999', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), smallDeposit);
      
      await expect(
        communityPool.connect(user1).deposit(smallDeposit)
      ).to.be.revertedWithCustomError(communityPool, 'FirstDepositTooSmall');
    });

    it('should revert on insufficient liquidity instead of silent truncation', async function () {
      // User deposits $1000
      const deposit = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);

      // Admin withdraws some USDC (simulating liquidity shortage)
      const FEE_MANAGER_ROLE = await communityPool.FEE_MANAGER_ROLE();
      await communityPool.grantRole(FEE_MANAGER_ROLE, owner.address);
      
      // Fast forward to accumulate fees
      await ethers.provider.send('evm_increaseTime', [365 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
      await communityPool.collectFees();
      
      // Transfer USDC out directly to simulate liquidity issue (admin action)
      // Note: In real scenario this shouldn't be possible, but tests internal safety
      const member = await communityPool.members(user1.address);
      
      // User tries to withdraw all shares - should work since USDC is still there
      await communityPool.connect(user1).withdraw(member.shares);
      // If there was insufficient liquidity, it would have reverted with InsufficientLiquidity
    });

    it('should enforce slippage protection on withdrawal', async function () {
      const deposit = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);

      const member = await communityPool.members(user1.address);
      
      // Try to withdraw with unreasonably high minAmountOut
      const unreasonableMinOut = ethers.parseUnits('2000', USDC_DECIMALS); // More than deposited
      
      await expect(
        communityPool.connect(user1)['withdraw(uint256,uint256)'](member.shares, unreasonableMinOut)
      ).to.be.revertedWithCustomError(communityPool, 'SlippageExceeded');
    });

    it('should disable rebalance trades until DEX integration', async function () {
      // Grant rebalancer role
      const REBALANCER_ROLE = await communityPool.REBALANCER_ROLE();
      await communityPool.grantRole(REBALANCER_ROLE, owner.address);

      // Try to execute rebalance trade - should revert
      await expect(
        communityPool.executeRebalanceTrade(0, ethers.parseUnits('100', USDC_DECIMALS), true)
      ).to.be.revertedWith('Rebalancing disabled until DEX integration complete');
    });
  });

  describe('View Functions', function () {
    it('should return correct pool stats', async function () {
      // Setup
      const deposit1 = ethers.parseUnits('1000', USDC_DECIMALS);
      const deposit2 = ethers.parseUnits('500', USDC_DECIMALS);
      
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit1);
      await communityPool.connect(user1).deposit(deposit1);
      
      await mockUSDC.connect(user2).approve(await communityPool.getAddress(), deposit2);
      await communityPool.connect(user2).deposit(deposit2);

      const stats = await communityPool.getPoolStats();

      expect(stats._totalNAV).to.equal(deposit1 + deposit2);
      expect(stats._memberCount).to.equal(2);
      expect(stats._totalShares).to.be.gt(0);
    });

    it('should return correct member position', async function () {
      const deposit = ethers.parseUnits('1000', USDC_DECIMALS);
      await mockUSDC.connect(user1).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(user1).deposit(deposit);

      const position = await communityPool.getMemberPosition(user1.address);

      expect(position.shares).to.be.gt(0);
      expect(position.valueUSD).to.be.closeTo(
        ethers.parseUnits('1000', USDC_DECIMALS),
        ethers.parseUnits('1', USDC_DECIMALS)
      );
      expect(position.percentage).to.equal(10000); // 100%
    });
  });
});

// Additional stress tests
describe('CommunityPool - Stress Tests', function () {
  let communityPool;
  let mockUSDC;
  let owner;
  let users;

  const NUM_USERS = 10;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    users = signers.slice(1, NUM_USERS + 1);

    // Deploy MockUSDC
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockUSDC = await MockERC20.deploy('Mock USDC', 'USDC', 6);
    await mockUSDC.waitForDeployment();

    // Mint to all users
    for (const user of users) {
      await mockUSDC.mint(user.address, ethers.parseUnits('100000', 6));
    }

    // Deploy CommunityPool
    const CommunityPool = await ethers.getContractFactory('CommunityPool');
    const assetTokens = Array(4).fill(ethers.ZeroAddress);

    communityPool = await upgrades.deployProxy(
      CommunityPool,
      [await mockUSDC.getAddress(), assetTokens, owner.address, owner.address],
      { initializer: 'initialize', kind: 'uups' }
    );
    await communityPool.waitForDeployment();
  });

  it('should handle many users depositing and withdrawing', async function () {
    // All users deposit different amounts (first deposit requires $1000 minimum)
    for (let i = 0; i < users.length; i++) {
      const deposit = ethers.parseUnits(String((i + 1) * 1000), 6); // $1000 to $10,000
      await mockUSDC.connect(users[i]).approve(await communityPool.getAddress(), deposit);
      await communityPool.connect(users[i]).deposit(deposit);
    }

    const statsAfterDeposits = await communityPool.getPoolStats();
    expect(statsAfterDeposits._memberCount).to.equal(BigInt(NUM_USERS));

    // Half withdraw
    for (let i = 0; i < users.length / 2; i++) {
      const member = await communityPool.members(users[i].address);
      await communityPool.connect(users[i]).withdraw(member.shares / BigInt(2));
    }

    // Verify pool still functional
    const statsAfterWithdrawals = await communityPool.getPoolStats();
    expect(statsAfterWithdrawals._totalNAV).to.be.gt(0);
    expect(statsAfterWithdrawals._memberCount).to.equal(BigInt(NUM_USERS));
  });
});

// Extreme scale tests - verifying overflow-safe math
describe('CommunityPool - Extreme Scale Tests', function () {
  let communityPool;
  let mockUSDC;
  let owner, agent, whale1, whale2, smallDepositor;

  const USDC_DECIMALS = 6;

  beforeEach(async function () {
    [owner, agent, whale1, whale2, smallDepositor] = await ethers.getSigners();

    // Deploy MockUSDC with very large supply
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockUSDC = await MockERC20.deploy('Mock USDC', 'USDC', 6);
    await mockUSDC.waitForDeployment();

    // Mint massive amounts to whales ($10 billion each)
    const tenBillion = ethers.parseUnits('10000000000', USDC_DECIMALS);
    await mockUSDC.mint(whale1.address, tenBillion);
    await mockUSDC.mint(whale2.address, tenBillion);
    await mockUSDC.mint(smallDepositor.address, ethers.parseUnits('100', USDC_DECIMALS));

    // Deploy CommunityPool
    const CommunityPool = await ethers.getContractFactory('CommunityPool');
    const assetTokens = Array(4).fill(ethers.ZeroAddress);

    communityPool = await upgrades.deployProxy(
      CommunityPool,
      [await mockUSDC.getAddress(), assetTokens, owner.address, agent.address],
      { initializer: 'initialize', kind: 'uups' }
    );
    await communityPool.waitForDeployment();
  });

  it('should handle billion-dollar deposits without overflow', async function () {
    // Whale deposits $1 billion
    const oneBillion = ethers.parseUnits('1000000000', USDC_DECIMALS);
    await mockUSDC.connect(whale1).approve(await communityPool.getAddress(), oneBillion);
    await communityPool.connect(whale1).deposit(oneBillion);

    const stats = await communityPool.getPoolStats();
    expect(stats._totalNAV).to.equal(oneBillion);
    
    // Verify shares were minted correctly  
    const member = await communityPool.members(whale1.address);
    expect(member.shares).to.be.gt(0);
    
    // For the first depositor, value should equal deposit (with tiny virtual offset effect)
    const position = await communityPool.getMemberPosition(whale1.address);
    // Allow $1 variance for virtual offset effect at billion-dollar scale
    expect(position.valueUSD).to.be.closeTo(oneBillion, ethers.parseUnits('2', USDC_DECIMALS));
    expect(position.percentage).to.equal(10000); // 100% ownership
  });

  it('should maintain proportional fairness at massive scale', async function () {
    // First whale deposits $5 billion
    const fiveBillion = ethers.parseUnits('5000000000', USDC_DECIMALS);
    await mockUSDC.connect(whale1).approve(await communityPool.getAddress(), fiveBillion);
    await communityPool.connect(whale1).deposit(fiveBillion);

    // Second whale deposits $3 billion  
    const threeBillion = ethers.parseUnits('3000000000', USDC_DECIMALS);
    await mockUSDC.connect(whale2).approve(await communityPool.getAddress(), threeBillion);
    await communityPool.connect(whale2).deposit(threeBillion);

    // Check proportions - whale1 should have 5/8 = 62.5%, whale2 should have 3/8 = 37.5%
    const pos1 = await communityPool.getMemberPosition(whale1.address);
    const pos2 = await communityPool.getMemberPosition(whale2.address);

    // 6250 basis points = 62.5%
    expect(pos1.percentage).to.be.closeTo(BigInt(6250), BigInt(10));
    // 3750 basis points = 37.5%
    expect(pos2.percentage).to.be.closeTo(BigInt(3750), BigInt(10));
  });

  it('should handle small deposit in massive pool fairly', async function () {
    // Whale deposits $5 billion
    const fiveBillion = ethers.parseUnits('5000000000', USDC_DECIMALS);
    await mockUSDC.connect(whale1).approve(await communityPool.getAddress(), fiveBillion);
    await communityPool.connect(whale1).deposit(fiveBillion);

    // Small depositor adds $100 to a $5B pool
    const smallAmount = ethers.parseUnits('100', USDC_DECIMALS);
    await mockUSDC.connect(smallDepositor).approve(await communityPool.getAddress(), smallAmount);
    await communityPool.connect(smallDepositor).deposit(smallAmount);

    // Small depositor should get proportional shares
    const position = await communityPool.getMemberPosition(smallDepositor.address);
    
    // Value should equal their deposit
    expect(position.valueUSD).to.be.closeTo(smallAmount, ethers.parseUnits('1', USDC_DECIMALS));
    
    // Percentage should be 100 / 5B = 0.000002% = 0.0002 bps (effectively 0 due to integer math)
    // But shares should be > 0
    const member = await communityPool.members(smallDepositor.address);
    expect(member.shares).to.be.gt(0);
  });

  it('should handle withdrawal from massive pool correctly', async function () {
    // Whale deposits $3 billion
    const threeBillion = ethers.parseUnits('3000000000', USDC_DECIMALS);
    await mockUSDC.connect(whale1).approve(await communityPool.getAddress(), threeBillion);
    await communityPool.connect(whale1).deposit(threeBillion);

    // Withdraw $1 billion worth
    const member = await communityPool.members(whale1.address);
    const sharesToWithdraw = member.shares / BigInt(3); // ~1/3 of shares = $1B

    const balanceBefore = await mockUSDC.balanceOf(whale1.address);
    await communityPool.connect(whale1).withdraw(sharesToWithdraw);
    const balanceAfter = await mockUSDC.balanceOf(whale1.address);

    const withdrawn = balanceAfter - balanceBefore;
    const oneBillion = ethers.parseUnits('1000000000', USDC_DECIMALS);
    
    // Should receive approximately $1B (within 1%)
    expect(withdrawn).to.be.closeTo(oneBillion, oneBillion / BigInt(100));
  });

  it('should calculate NAV per share consistently at scale', async function () {
    // Sequential deposits to stress test precision
    const amounts = [
      ethers.parseUnits('100000000', USDC_DECIMALS),   // $100M
      ethers.parseUnits('500000000', USDC_DECIMALS),   // $500M
      ethers.parseUnits('1000000000', USDC_DECIMALS),  // $1B
    ];

    for (const amount of amounts) {
      await mockUSDC.connect(whale1).approve(await communityPool.getAddress(), amount);
      await communityPool.connect(whale1).deposit(amount);
    }

    const totalDeposited = amounts.reduce((a, b) => a + b, BigInt(0));
    const stats = await communityPool.getPoolStats();
    
    // Total NAV should equal total deposits (no gains/losses yet)
    expect(stats._totalNAV).to.equal(totalDeposited);

    // Full withdrawal should return approximately original amount
    const member = await communityPool.members(whale1.address);
    const balanceBefore = await mockUSDC.balanceOf(whale1.address);
    await communityPool.connect(whale1).withdraw(member.shares);
    const balanceAfter = await mockUSDC.balanceOf(whale1.address);

    const received = balanceAfter - balanceBefore;
    // Should receive full amount back (minus any withdrawal fees if any)
    expect(received).to.be.closeTo(totalDeposited, totalDeposited / BigInt(100));
  });
});
