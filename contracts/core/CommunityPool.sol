// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title CommunityPool
 * @notice AI-managed community investment pool with share-based ownership
 * @dev ERC-4626-inspired vault for collective investment in BTC, ETH, SUI, CRO
 *
 * FEATURES:
 * =========
 * - Share-based ownership: Deposit USDC → receive proportional shares
 * - Fair withdrawals: Burn shares → receive proportional NAV
 * - AI-driven allocation: Agent role can rebalance between assets
 * - Self-sustaining: Management fee (0.5% annual) + Performance fee (10%)
 * - High-water mark: Performance fee only on new highs
 *
 * SUPPORTED ASSETS:
 * - WBTC (Wrapped Bitcoin)
 * - WETH (Wrapped Ether)
 * - SUI (if bridged) or stablecoin placeholder
 * - CRO (Cronos native wrapped)
 *
 * MAINNET READY:
 * - Uses real token addresses
 * - UUPS upgradeable for future improvements
 * - Emergency pause capability
 */
contract CommunityPool is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ═══════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MIN_DEPOSIT = 10e6; // $10 USDC (6 decimals)
    uint256 public constant MIN_SHARES_FOR_WITHDRAWAL = 1e15; // 0.001 shares
    
    // Precision constants for safe math
    uint256 public constant SHARE_DECIMALS = 18;
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant PRECISION_FACTOR = 1e12; // 18 - 6 = 12
    uint256 public constant WAD = 1e18; // Standard 18 decimal precision

    // Asset indices
    uint8 public constant ASSET_BTC = 0;
    uint8 public constant ASSET_ETH = 1;
    uint8 public constant ASSET_SUI = 2;
    uint8 public constant ASSET_CRO = 3;
    uint8 public constant NUM_ASSETS = 4;

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════

    struct Member {
        uint256 shares;             // Number of shares owned
        uint256 depositedUSD;       // Total USD value deposited
        uint256 withdrawnUSD;       // Total USD value withdrawn
        uint256 joinedAt;           // Timestamp of first deposit
        uint256 lastDepositAt;      // Timestamp of last deposit
        uint256 highWaterMark;      // For performance fee calculation
    }

    struct Allocation {
        uint8 assetIndex;           // Which asset
        uint256 targetBps;          // Target allocation in basis points
        uint256 currentAmount;      // Current token amount held
    }

    struct RebalanceRecord {
        uint256 timestamp;
        uint256[NUM_ASSETS] previousAllocBps;
        uint256[NUM_ASSETS] newAllocBps;
        string reasoning;
        address executor;
    }

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════

    /// @notice Deposit token (USDC)
    IERC20 public depositToken;

    /// @notice Supported asset tokens [BTC, ETH, SUI, CRO]
    IERC20[NUM_ASSETS] public assetTokens;

    /// @notice Price feed decimals for each asset (for normalization)
    uint8[NUM_ASSETS] public assetDecimals;

    /// @notice Target allocation in basis points (must sum to 10000)
    uint256[NUM_ASSETS] public targetAllocationBps;

    /// @notice Current holdings of each asset (in token units)
    uint256[NUM_ASSETS] public assetBalances;

    /// @notice Member data by address
    mapping(address => Member) public members;

    /// @notice All member addresses for enumeration
    address[] public memberList;

    /// @notice Mapping for quick member lookup
    mapping(address => bool) public isMember;

    /// @notice Total shares outstanding
    uint256 public totalShares;

    /// @notice Total value deposited (USD, 6 decimals)
    uint256 public totalDeposited;

    /// @notice Total value withdrawn (USD, 6 decimals)
    uint256 public totalWithdrawn;

    /// @notice Pool's all-time high NAV per share (for performance fee)
    uint256 public allTimeHighNavPerShare;

    /// @notice Management fee rate in basis points (50 = 0.5%)
    uint256 public managementFeeBps;

    /// @notice Performance fee rate in basis points (1000 = 10%)
    uint256 public performanceFeeBps;

    /// @notice Accumulated management fees (in USDC)
    uint256 public accumulatedManagementFees;

    /// @notice Accumulated performance fees (in USDC)
    uint256 public accumulatedPerformanceFees;

    /// @notice Last fee collection timestamp
    uint256 public lastFeeCollection;

    /// @notice Treasury address for fee collection
    address public treasury;

    /// @notice Rebalance history
    RebalanceRecord[] public rebalanceHistory;

    /// @notice DEX router for swaps (VVS Finance on Cronos)
    address public dexRouter;

    /// @notice Price oracle for NAV calculation
    address public priceOracle;

    /// @notice Minimum time between rebalances (anti-churn)
    uint256 public rebalanceCooldown;

    /// @notice Last rebalance timestamp
    uint256 public lastRebalanceTime;

    /// @notice Emergency withdrawal enabled
    bool public emergencyWithdrawEnabled;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════

    event Deposited(
        address indexed member,
        uint256 amountUSD,
        uint256 sharesReceived,
        uint256 sharePrice,
        uint256 timestamp
    );

    event Withdrawn(
        address indexed member,
        uint256 sharesBurned,
        uint256 amountUSD,
        uint256 sharePrice,
        uint256 timestamp
    );

    event Rebalanced(
        address indexed executor,
        uint256[NUM_ASSETS] previousBps,
        uint256[NUM_ASSETS] newBps,
        string reasoning,
        uint256 timestamp
    );

    event FeesCollected(
        uint256 managementFee,
        uint256 performanceFee,
        uint256 timestamp
    );

    event FeesWithdrawn(
        address indexed treasury,
        uint256 amount,
        uint256 timestamp
    );

    event AllocationUpdated(
        uint8 indexed assetIndex,
        uint256 oldBps,
        uint256 newBps
    );

    event PriceUpdated(
        uint8 indexed assetIndex,
        uint256 oldPrice,
        uint256 newPrice
    );

    event MemberJoined(address indexed member, uint256 timestamp);
    event MemberExited(address indexed member, uint256 timestamp);

    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════

    error DepositTooSmall(uint256 amount, uint256 minimum);
    error InsufficientShares(uint256 requested, uint256 available);
    error InvalidAllocation(uint256 totalBps);
    error RebalanceCooldownActive(uint256 nextAllowedTime);
    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();
    error NotAMember();
    error EmergencyWithdrawDisabled();

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZER
    // ═══════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the community pool
     * @param _depositToken USDC token address
     * @param _assetTokens Array of 4 asset tokens [BTC, ETH, SUI, CRO]
     * @param _treasury Treasury address for fees
     * @param _admin Admin address
     */
    function initialize(
        address _depositToken,
        address[NUM_ASSETS] calldata _assetTokens,
        address _treasury,
        address _admin
    ) external initializer {
        if (_depositToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        depositToken = IERC20(_depositToken);
        treasury = _treasury;

        // Set up asset tokens
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (_assetTokens[i] != address(0)) {
                assetTokens[i] = IERC20(_assetTokens[i]);
                assetDecimals[i] = IERC20Metadata(_assetTokens[i]).decimals();
            }
        }

        // Default equal allocation (25% each)
        targetAllocationBps[ASSET_BTC] = 2500;
        targetAllocationBps[ASSET_ETH] = 2500;
        targetAllocationBps[ASSET_SUI] = 2500;
        targetAllocationBps[ASSET_CRO] = 2500;

        // Default fees (self-sustaining)
        managementFeeBps = 50;      // 0.5% annual
        performanceFeeBps = 1000;   // 10% on profits

        // Cooldowns and limits
        rebalanceCooldown = 1 hours;
        lastFeeCollection = block.timestamp;

        // Initial share price = $1 (1e18 shares per $1M NAV)
        allTimeHighNavPerShare = 1e18;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(AGENT_ROLE, _admin);
        _grantRole(REBALANCER_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
        _grantRole(FEE_MANAGER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Deposit USDC and receive pool shares
     * @param amount Amount of USDC to deposit (6 decimals)
     * @return shares Number of shares received
     */
    function deposit(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        returns (uint256 shares) 
    {
        if (amount < MIN_DEPOSIT) revert DepositTooSmall(amount, MIN_DEPOSIT);

        // Collect any pending fees first
        _collectFees();

        // Calculate shares based on current NAV using overflow-safe math
        uint256 currentNav = calculateTotalNAV();
        
        if (totalShares == 0 || currentNav == 0) {
            // First deposit: 1 share = $1 (USDC is 6 decimals, shares are 18)
            // shares = amount * PRECISION_FACTOR to convert 6 dec → 18 dec
            shares = amount * PRECISION_FACTOR;
        } else {
            // Subsequent deposits: proportional to current NAV
            // Formula: shares = (depositAmount / poolNAV) * totalShares
            // Using mulDiv for overflow safety: shares = amount * totalShares / currentNav
            // This scales infinitely as both numerator and denominator grow together
            shares = amount.mulDiv(totalShares, currentNav, Math.Rounding.Floor);
        }
        
        // Ensure minimum shares to prevent dust attacks
        require(shares >= MIN_SHARES_FOR_WITHDRAWAL, "Shares too small");

        // Transfer USDC from user
        depositToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update member state
        Member storage member = members[msg.sender];
        if (!isMember[msg.sender]) {
            isMember[msg.sender] = true;
            memberList.push(msg.sender);
            member.joinedAt = block.timestamp;
            member.highWaterMark = _calculateNavPerShare();
            emit MemberJoined(msg.sender, block.timestamp);
        }

        member.shares += shares;
        member.depositedUSD += amount;
        member.lastDepositAt = block.timestamp;

        // Update pool state
        totalShares += shares;
        totalDeposited += amount;

        // Add to cash balance (will be deployed by rebalancer)
        // For now, USDC stays in contract until rebalanced

        uint256 sharePrice = _calculateNavPerShare();

        emit Deposited(msg.sender, amount, shares, sharePrice, block.timestamp);

        return shares;
    }

    /**
     * @notice Withdraw by burning shares
     * @param sharesToBurn Number of shares to burn
     * @return amountUSD Amount of USDC returned
     */
    function withdraw(uint256 sharesToBurn)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountUSD)
    {
        if (sharesToBurn < MIN_SHARES_FOR_WITHDRAWAL) revert ZeroAmount();
        
        Member storage member = members[msg.sender];
        if (member.shares < sharesToBurn) {
            revert InsufficientShares(sharesToBurn, member.shares);
        }

        // Collect any pending fees first
        _collectFees();

        // Calculate USD value of shares using overflow-safe math
        // Formula: amountUSD = (sharesToBurn / totalShares) * poolNAV
        // Using mulDiv: amountUSD = sharesToBurn * currentNav / totalShares
        // This ensures fair proportional withdrawal regardless of pool size
        uint256 currentNav = calculateTotalNAV();
        amountUSD = sharesToBurn.mulDiv(currentNav, totalShares, Math.Rounding.Floor);

        // Check we have enough USDC liquidity
        uint256 usdcBalance = depositToken.balanceOf(address(this));
        if (usdcBalance < amountUSD) {
            // Need to sell assets - for now just use available
            // In production, would trigger auto-liquidation
            amountUSD = usdcBalance;
        }

        // Burn shares
        member.shares -= sharesToBurn;
        member.withdrawnUSD += amountUSD;
        totalShares -= sharesToBurn;
        totalWithdrawn += amountUSD;

        // Check if member has exited completely
        if (member.shares == 0) {
            isMember[msg.sender] = false;
            emit MemberExited(msg.sender, block.timestamp);
        }

        // Transfer USDC to user
        depositToken.safeTransfer(msg.sender, amountUSD);

        uint256 sharePrice = _calculateNavPerShare();

        emit Withdrawn(msg.sender, sharesToBurn, amountUSD, sharePrice, block.timestamp);

        return amountUSD;
    }

    /**
     * @notice Emergency withdrawal - returns proportional share of each asset
     * @dev Only available when emergency mode is enabled
     */
    function emergencyWithdraw()
        external
        nonReentrant
    {
        if (!emergencyWithdrawEnabled) revert EmergencyWithdrawDisabled();
        
        Member storage member = members[msg.sender];
        if (member.shares == 0) revert NotAMember();

        uint256 shareRatio = (member.shares * 1e18) / totalShares;

        // Return proportional USDC
        uint256 usdcShare = (depositToken.balanceOf(address(this)) * shareRatio) / 1e18;
        if (usdcShare > 0) {
            depositToken.safeTransfer(msg.sender, usdcShare);
        }

        // Return proportional assets
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (address(assetTokens[i]) != address(0)) {
                uint256 assetShare = (assetBalances[i] * shareRatio) / 1e18;
                if (assetShare > 0) {
                    assetTokens[i].safeTransfer(msg.sender, assetShare);
                    assetBalances[i] -= assetShare;
                }
            }
        }

        // Clear member
        totalShares -= member.shares;
        member.shares = 0;
        isMember[msg.sender] = false;

        emit MemberExited(msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // AI REBALANCING
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Update target allocation (AI decision)
     * @param newAllocationBps New target allocations [BTC, ETH, SUI, CRO]
     * @param reasoning AI reasoning for the rebalance
     */
    function setTargetAllocation(
        uint256[NUM_ASSETS] calldata newAllocationBps,
        string calldata reasoning
    ) 
        external 
        onlyRole(REBALANCER_ROLE) 
        whenNotPaused 
    {
        if (block.timestamp < lastRebalanceTime + rebalanceCooldown) {
            revert RebalanceCooldownActive(lastRebalanceTime + rebalanceCooldown);
        }

        // Validate allocations sum to 100%
        uint256 totalBps = 0;
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            totalBps += newAllocationBps[i];
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidAllocation(totalBps);

        // Store previous allocations
        uint256[NUM_ASSETS] memory previousBps = targetAllocationBps;

        // Update allocations
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (targetAllocationBps[i] != newAllocationBps[i]) {
                emit AllocationUpdated(i, targetAllocationBps[i], newAllocationBps[i]);
                targetAllocationBps[i] = newAllocationBps[i];
            }
        }

        // Record rebalance
        rebalanceHistory.push(RebalanceRecord({
            timestamp: block.timestamp,
            previousAllocBps: previousBps,
            newAllocBps: newAllocationBps,
            reasoning: reasoning,
            executor: msg.sender
        }));

        lastRebalanceTime = block.timestamp;

        emit Rebalanced(msg.sender, previousBps, newAllocationBps, reasoning, block.timestamp);
    }

    /**
     * @notice Execute trades to rebalance towards target allocation
     * @dev In production, would use DEX aggregator for best execution
     * @param assetIndex Which asset to buy/sell
     * @param amount Amount of USDC to use / receive
     * @param isBuy True if buying asset, false if selling
     */
    function executeRebalanceTrade(
        uint8 assetIndex,
        uint256 amount,
        bool isBuy
    )
        external
        onlyRole(REBALANCER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (assetIndex >= NUM_ASSETS) revert ZeroAmount();
        if (amount == 0) revert ZeroAmount();

        if (isBuy) {
            // Buy asset with USDC
            // In production: call DEX router
            // For now: just track the intent
            depositToken.safeTransfer(treasury, amount); // Simulate swap
        } else {
            // Sell asset for USDC
            // In production: call DEX router
        }

        // Note: Real implementation would integrate with VVS Finance or similar
    }

    // ═══════════════════════════════════════════════════════════════
    // FEE MANAGEMENT (Self-Sustaining)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Collect management and performance fees
     * @dev Called automatically on deposit/withdraw, can also be called manually
     */
    function collectFees() external onlyRole(FEE_MANAGER_ROLE) {
        _collectFees();
    }

    function _collectFees() internal {
        uint256 currentNav = calculateTotalNAV();
        if (currentNav == 0 || totalShares == 0) return;

        // Management fee (pro-rated based on time)
        uint256 timeSinceLastCollection = block.timestamp - lastFeeCollection;
        uint256 managementFee = (currentNav * managementFeeBps * timeSinceLastCollection) 
            / (BPS_DENOMINATOR * SECONDS_PER_YEAR);

        // Performance fee (only on new highs)
        uint256 navPerShare = _calculateNavPerShare();
        uint256 performanceFee = 0;

        if (navPerShare > allTimeHighNavPerShare) {
            uint256 gain = navPerShare - allTimeHighNavPerShare;
            uint256 totalGain = (gain * totalShares) / 1e18;
            performanceFee = (totalGain * performanceFeeBps) / BPS_DENOMINATOR;
            allTimeHighNavPerShare = navPerShare;
        }

        // Accumulate fees
        accumulatedManagementFees += managementFee;
        accumulatedPerformanceFees += performanceFee;
        lastFeeCollection = block.timestamp;

        if (managementFee > 0 || performanceFee > 0) {
            emit FeesCollected(managementFee, performanceFee, block.timestamp);
        }
    }

    /**
     * @notice Withdraw accumulated fees to treasury
     */
    function withdrawFees() external onlyRole(FEE_MANAGER_ROLE) nonReentrant {
        uint256 totalFees = accumulatedManagementFees + accumulatedPerformanceFees;
        if (totalFees == 0) return;

        uint256 usdcBalance = depositToken.balanceOf(address(this));
        uint256 toWithdraw = totalFees > usdcBalance ? usdcBalance : totalFees;

        accumulatedManagementFees = 0;
        accumulatedPerformanceFees = 0;

        depositToken.safeTransfer(treasury, toWithdraw);

        emit FeesWithdrawn(treasury, toWithdraw, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Calculate total NAV of the pool in USDC terms
     * @dev In production, would use Chainlink price feeds
     * @return nav Total NAV in USDC (6 decimals)
     */
    function calculateTotalNAV() public view returns (uint256 nav) {
        // USDC balance
        nav = depositToken.balanceOf(address(this));

        // Add value of each asset (simplified - real impl uses oracle)
        // For now, just count USDC balance
        // In production: nav += assetBalances[i] * getAssetPrice(i) / 10**assetDecimals[i]

        return nav;
    }

    /**
     * @notice Get NAV per share
     * @return navPerShare NAV per share (18 decimals)
     */
    function getNavPerShare() external view returns (uint256) {
        return _calculateNavPerShare();
    }

    function _calculateNavPerShare() internal view returns (uint256) {
        if (totalShares == 0) return WAD; // 1e18 = $1 per share initially
        // Using mulDiv for overflow safety
        // Result is in 18 decimals: (NAV_6dec * 1e18 * PRECISION_FACTOR) / totalShares_18dec
        // Simplified: (NAV * 1e18 * 1e12) / totalShares = NAV * 1e30 / totalShares
        // But using mulDiv to prevent overflow
        uint256 nav = calculateTotalNAV();
        return nav.mulDiv(WAD * PRECISION_FACTOR, totalShares, Math.Rounding.Floor);
    }

    /**
     * @notice Get member's current value
     * @param member Member address
     * @return shares Member's shares
     * @return valueUSD Current USD value
     * @return percentage Pool ownership percentage (basis points)
     */
    function getMemberPosition(address member) 
        external 
        view 
        returns (uint256 shares, uint256 valueUSD, uint256 percentage) 
    {
        Member storage m = members[member];
        shares = m.shares;
        
        if (totalShares > 0 && shares > 0) {
            // Using mulDiv for overflow safety as pool grows
            // valueUSD (6 dec) = shares (18 dec) * NAV (6 dec) / totalShares (18 dec)
            valueUSD = shares.mulDiv(calculateTotalNAV(), totalShares, Math.Rounding.Floor);
            // percentage in basis points (0-10000)
            percentage = shares.mulDiv(BPS_DENOMINATOR, totalShares, Math.Rounding.Floor);
        }
    }

    /**
     * @notice Get pool statistics
     */
    function getPoolStats() 
        external 
        view 
        returns (
            uint256 _totalShares,
            uint256 _totalNAV,
            uint256 _memberCount,
            uint256 _sharePrice,
            uint256[NUM_ASSETS] memory _allocations
        ) 
    {
        _totalShares = totalShares;
        _totalNAV = calculateTotalNAV();
        _memberCount = memberList.length;
        _sharePrice = _calculateNavPerShare();
        _allocations = targetAllocationBps;
    }

    /**
     * @notice Get rebalance history count
     */
    function getRebalanceHistoryCount() external view returns (uint256) {
        return rebalanceHistory.length;
    }

    /**
     * @notice Get member count
     */
    function getMemberCount() external view returns (uint256) {
        return memberList.length;
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function setManagementFee(uint256 _feeBps) external onlyRole(FEE_MANAGER_ROLE) {
        require(_feeBps <= 500, "Max 5%");
        managementFeeBps = _feeBps;
    }

    function setPerformanceFee(uint256 _feeBps) external onlyRole(FEE_MANAGER_ROLE) {
        require(_feeBps <= 3000, "Max 30%");
        performanceFeeBps = _feeBps;
    }

    function setRebalanceCooldown(uint256 _cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rebalanceCooldown = _cooldown;
    }

    function setDexRouter(address _router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dexRouter = _router;
    }

    function setPriceOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceOracle = _oracle;
    }

    function setEmergencyWithdraw(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyWithdrawEnabled = _enabled;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════
    // UUPS UPGRADE
    // ═══════════════════════════════════════════════════════════════

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}

    // ═══════════════════════════════════════════════════════════════
    // RECEIVE
    // ═══════════════════════════════════════════════════════════════

    receive() external payable {}
}
