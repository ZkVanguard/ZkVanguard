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
 * @title IVVSRouter
 * @notice Interface for VVS Finance Router on Cronos
 * @dev Standard Uniswap V2 compatible router interface
 */
interface IVVSRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) external view returns (uint[] memory amounts);

    function getAmountsIn(
        uint amountOut,
        address[] memory path
    ) external view returns (uint[] memory amounts);
}

/**
 * @title IPyth
 * @notice Pyth Network Price Feed Interface (Available on Cronos)
 * @dev Pyth is the standard oracle on Cronos used by Moonlander and other DeFi
 *      Free to read prices, costs ~0.06 CRO to update price feeds
 *      Cronos Mainnet: 0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B
 */
interface IPyth {
    struct Price {
        int64 price;        // Price in base units
        uint64 conf;        // Confidence interval
        int32 expo;         // Exponent (negative = decimals)
        uint publishTime;   // Unix timestamp
    }

    /// @notice Get price no older than `age` seconds, reverts if stale
    function getPriceNoOlderThan(
        bytes32 id,
        uint age
    ) external view returns (Price memory price);

    /// @notice Get latest price (may be stale)
    function getPrice(bytes32 id) external view returns (Price memory price);

    /// @notice Update price feeds (requires payment)
    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    /// @notice Get update fee for price data
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount);

    /// @notice Check if price feed exists
    function priceFeedExists(bytes32 id) external view returns (bool);
}

/**
 * @title IHedgeExecutor
 * @notice Interface for HedgeExecutor contract used for x402 gasless auto-hedging
 */
interface IHedgeExecutor {
    function openHedge(
        uint256 pairIndex,
        uint256 collateralAmount,
        uint256 leverage,
        bool isLong,
        bytes32 commitmentHash,
        bytes32 nullifier,
        bytes32 merkleRoot
    ) external payable returns (bytes32 hedgeId);

    function closeHedge(bytes32 hedgeId) external;

    function hedges(bytes32 hedgeId) external view returns (
        bytes32 _hedgeId,
        address trader,
        uint256 pairIndex,
        uint256 tradeIndex,
        uint256 collateralAmount,
        uint256 leverage,
        bool isLong,
        bytes32 commitmentHash,
        bytes32 nullifier,
        uint256 openTimestamp,
        uint256 closeTimestamp,
        int256 realizedPnl,
        uint8 status
    );
}

/**
 * @title ZkVanguard Community Pool
 * @author ZkVanguard Team
 * @notice AI-managed community investment pool with share-based ownership
 * @dev ERC-4626-inspired vault for collective investment in BTC, ETH, SUI, CRO
 *
 * @custom:security-contact security@zkvanguard.xyz
 * @custom:oz-upgrades-from CommunityPool
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
    uint256 public constant MIN_FIRST_DEPOSIT = 100e6; // $100 USDC minimum first deposit (virtual shares protect against inflation)
    uint256 public constant VIRTUAL_SHARES = 1e18; // Virtual offset to prevent inflation attack
    uint256 public constant VIRTUAL_ASSETS = 1e6; // Virtual offset ($1 USDC)
    
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

    /// @notice Pyth Network oracle contract (Cronos: 0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B)
    IPyth public pythOracle;

    /// @notice Pyth price IDs for each asset (USD denominated)
    /// @dev Universal across all Pyth-supported chains
    ///      Index: 0=BTC/USD, 1=ETH/USD, 2=SUI/USD, 3=CRO/USD
    bytes32[NUM_ASSETS] public pythPriceIds;

    /// @notice Maximum age of price data before considered stale (default: 1 hour)
    uint256 public priceStaleThreshold;

    /// @notice Minimum time between rebalances (anti-churn)
    uint256 public rebalanceCooldown;

    /// @notice Last rebalance timestamp
    uint256 public lastRebalanceTime;

    /// @notice Emergency withdrawal enabled
    bool public emergencyWithdrawEnabled;

    // ═══════════════════════════════════════════════════════════════
    // AUTO-HEDGE INTEGRATION (x402 Gasless)
    // ═══════════════════════════════════════════════════════════════

    /// @notice HedgeExecutor contract for auto-hedging
    address public hedgeExecutor;

    /// @notice Active hedge IDs opened by this pool
    bytes32[] public activePoolHedges;

    /// @notice Mapping of hedge ID to active status
    mapping(bytes32 => bool) public isPoolHedge;

    /// @notice Auto-hedge configuration
    struct AutoHedgeConfig {
        bool enabled;              // Whether auto-hedging is enabled
        uint256 riskThresholdBps;  // Risk level to trigger hedge (e.g., 500 = 5% drawdown)
        uint256 maxHedgeRatioBps;  // Max portion of NAV to hedge (e.g., 2500 = 25%)
        uint256 defaultLeverage;   // Default leverage for hedges (2-10)
        uint256 cooldownSeconds;   // Min time between auto-hedges
        uint256 lastAutoHedgeTime; // Last auto-hedge timestamp
    }

    /// @notice Pool's auto-hedge configuration
    AutoHedgeConfig public autoHedgeConfig;

    /// @notice Total value currently hedged (USD, 6 decimals)
    uint256 public totalHedgedValue;

    /// @notice Oracle fee for Moonlander trades (CRO)
    uint256 public constant MOONLANDER_ORACLE_FEE = 0.06 ether;

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

    event RebalanceTradeExecuted(
        uint8 indexed assetIndex,
        uint256 amountIn,
        uint256 amountOut,
        bool isBuy,
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

    event PriceFeedSet(
        uint8 indexed assetIndex,
        address indexed priceFeed
    );

    event MemberJoined(address indexed member, uint256 timestamp);
    event MemberExited(address indexed member, uint256 timestamp);
    event TokensRescued(address indexed token, uint256 amount);

    // Auto-hedge events
    event PoolHedgeOpened(
        bytes32 indexed hedgeId,
        uint8 pairIndex,
        uint256 collateralAmount,
        uint256 leverage,
        bool isLong,
        string reason
    );

    event PoolHedgeClosed(
        bytes32 indexed hedgeId,
        int256 pnl,
        string reason
    );

    event AutoHedgeConfigUpdated(
        bool enabled,
        uint256 riskThresholdBps,
        uint256 maxHedgeRatioBps,
        uint256 defaultLeverage
    );

    event HedgeExecutorSet(address indexed newExecutor);

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
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error FirstDepositTooSmall(uint256 amount, uint256 minimum);
    error DexRouterNotSet();
    error InvalidSwapPath();
    error SwapSlippageExceeded(uint256 expected, uint256 received);
    error StalePriceData(uint8 assetIndex, uint256 lastUpdate, uint256 threshold);
    error NegativePrice(uint8 assetIndex, int256 price);
    error PriceFeedNotConfigured(uint8 assetIndex);
    error OracleCallFailed(uint8 assetIndex);
    error AssetWithoutPriceFeed(uint8 assetIndex, uint256 balance);
    error SharePriceTooLow(uint256 currentPrice, uint256 minimumPrice);
    error PoolUndercollateralized(uint256 nav, uint256 expectedMinNav);
    error HedgeExecutorNotSet();
    error AutoHedgeCooldownActive(uint256 nextAllowedTime);
    error HedgeNotOwnedByPool(bytes32 hedgeId);

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
     * @notice Deposit USDC into ZkVanguard Community Pool and receive shares
     * @dev Deposits USDC and mints proportional pool shares to the caller.
     *      Uses ERC-4626 virtual offset to prevent share inflation attacks.
     *      Your shares represent ownership of the pool's diversified portfolio.
     * @param amount Amount of USDC to deposit (6 decimals). Min: $10 USDC
     * @return shares Number of pool shares minted to your wallet
     * @custom:security Non-reentrant, requires active pool
     * @custom:emits Deposited(depositor, amount, shares, sharePrice, timestamp)
     */
    function deposit(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        returns (uint256 shares) 
    {
        // First deposit requires higher minimum to prevent inflation attack
        if (totalShares == 0 && amount < MIN_FIRST_DEPOSIT) {
            revert FirstDepositTooSmall(amount, MIN_FIRST_DEPOSIT);
        }
        if (amount < MIN_DEPOSIT) revert DepositTooSmall(amount, MIN_DEPOSIT);

        // SAFEGUARD: Verify pool isn't undercollateralized before accepting deposits
        // This prevents new depositors from getting unfair share dilution
        if (totalShares > 0) {
            uint256 currentSharePrice = _calculateNavPerShare();
            uint256 minSharePrice = 9e17; // $0.90 in WAD
            if (currentSharePrice < minSharePrice) {
                revert SharePriceTooLow(currentSharePrice, minSharePrice);
            }
        }

        // Collect any pending fees first
        _collectFees();

        // Calculate shares using virtual offset to prevent first depositor attack
        // This is the standard ERC-4626 defense against share inflation attacks
        // Virtual shares/assets are added to prevent manipulation
        uint256 currentNav = calculateTotalNAV();
        uint256 totalAssetsWithOffset = currentNav + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        // shares = (amount * totalSharesWithOffset) / totalAssetsWithOffset
        // Using mulDiv for overflow safety
        shares = amount.mulDiv(totalSharesWithOffset, totalAssetsWithOffset, Math.Rounding.Floor);
        
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

        // SAFEGUARD: Verify share price didn't drop below $0.90 after deposit
        // This catches any accounting anomalies or exploits
        uint256 newSharePrice = _calculateNavPerShare();
        uint256 minSharePrice = 9e17; // $0.90 in WAD (18 decimals)
        if (newSharePrice < minSharePrice) {
            revert SharePriceTooLow(newSharePrice, minSharePrice);
        }

        // Add to cash balance (will be deployed by rebalancer)
        // For now, USDC stays in contract until rebalanced

        uint256 sharePrice = _calculateNavPerShare();

        emit Deposited(msg.sender, amount, shares, sharePrice, block.timestamp);

        return shares;
    }

    /**
     * @notice Withdraw USDC from ZkVanguard Community Pool by burning shares
     * @dev Burns your pool shares and returns proportional USDC value.
     *      Includes slippage protection to ensure minimum received amount.
     *      Performance fees are deducted if profit above high-water mark.
     * @param sharesToBurn Number of your shares to redeem for USDC
     * @param minAmountOut Minimum USDC to receive (reverts if less - slippage protection)
     * @return amountUSD Amount of USDC transferred to your wallet
     * @custom:security Non-reentrant, requires active pool
     * @custom:emits Withdrawn(withdrawer, shares, amountUSD, sharePrice, timestamp)
     */
    function withdraw(uint256 sharesToBurn, uint256 minAmountOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountUSD)
    {
        return _withdrawInternal(sharesToBurn, minAmountOut);
    }

    /**
     * @notice Withdraw USDC from ZkVanguard Community Pool (no slippage protection)
     * @dev Burns your pool shares and returns proportional USDC value.
     *      WARNING: No minimum output protection - use withdraw(shares, minOut) for safety.
     * @param sharesToBurn Number of your shares to redeem for USDC
     * @return amountUSD Amount of USDC transferred to your wallet
     * @custom:security Non-reentrant, requires active pool
     */
    function withdraw(uint256 sharesToBurn)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountUSD)
    {
        return _withdrawInternal(sharesToBurn, 0);
    }

    function _withdrawInternal(uint256 sharesToBurn, uint256 minAmountOut)
        internal
        returns (uint256 amountUSD)
    {
        if (sharesToBurn < MIN_SHARES_FOR_WITHDRAWAL) revert ZeroAmount();
        
        Member storage member = members[msg.sender];
        if (member.shares < sharesToBurn) {
            revert InsufficientShares(sharesToBurn, member.shares);
        }

        // Collect any pending fees first
        _collectFees();

        // Calculate USD value of shares using virtual offset for consistency with deposits
        // This ensures symmetry between deposit and withdrawal calculations
        uint256 currentNav = calculateTotalNAV();
        uint256 totalAssetsWithOffset = currentNav + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        // amountUSD = sharesToBurn * totalAssetsWithOffset / totalSharesWithOffset
        amountUSD = sharesToBurn.mulDiv(totalAssetsWithOffset, totalSharesWithOffset, Math.Rounding.Floor);

        // Slippage protection - user specifies minimum acceptable output
        if (amountUSD < minAmountOut) {
            revert SlippageExceeded(amountUSD, minAmountOut);
        }

        // STRICT LIQUIDITY CHECK - REVERT if insufficient funds (don't silently give less)
        uint256 usdcBalance = depositToken.balanceOf(address(this));
        if (usdcBalance < amountUSD) {
            revert InsufficientLiquidity(amountUSD, usdcBalance);
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

        // Using mulDiv for overflow safety at any scale
        uint256 memberShares = member.shares;
        uint256 currentTotalShares = totalShares;

        // Return proportional USDC using overflow-safe math
        uint256 usdcShare = memberShares.mulDiv(depositToken.balanceOf(address(this)), currentTotalShares, Math.Rounding.Floor);
        if (usdcShare > 0) {
            depositToken.safeTransfer(msg.sender, usdcShare);
        }

        // Return proportional assets using overflow-safe math
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (address(assetTokens[i]) != address(0)) {
                uint256 assetShare = memberShares.mulDiv(assetBalances[i], currentTotalShares, Math.Rounding.Floor);
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
     * @notice Execute trades to rebalance towards target allocation via VVS Finance
     * @dev Uses VVS Finance DEX Router for on-chain swaps with slippage protection
     * @param assetIndex Which asset to buy/sell
     * @param amount Amount of USDC to use (if buying) or asset to sell
     * @param isBuy True if buying asset with USDC, false if selling asset for USDC
     * @param minAmountOut Minimum amount to receive (slippage protection)
     */
    function executeRebalanceTrade(
        uint8 assetIndex,
        uint256 amount,
        bool isBuy,
        uint256 minAmountOut
    )
        external
        onlyRole(REBALANCER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (assetIndex >= NUM_ASSETS) revert ZeroAmount();
        if (amount == 0) revert ZeroAmount();
        if (dexRouter == address(0)) revert DexRouterNotSet();
        if (address(assetTokens[assetIndex]) == address(0)) revert InvalidSwapPath();
        
        // CRITICAL: Must have price feed configured before acquiring assets
        // Otherwise we cannot accurately value the portfolio (billions at stake)
        if (pythPriceIds[assetIndex] == bytes32(0)) {
            revert PriceFeedNotConfigured(assetIndex);
        }

        IVVSRouter router = IVVSRouter(dexRouter);
        address[] memory path = new address[](2);
        uint256 deadline = block.timestamp + 300; // 5 minute deadline
        uint256 amountReceived;

        if (isBuy) {
            // Buy asset with USDC
            path[0] = address(depositToken);
            path[1] = address(assetTokens[assetIndex]);
            
            // Approve router to spend USDC
            depositToken.safeIncreaseAllowance(dexRouter, amount);
            
            // Execute swap
            uint256[] memory amounts = router.swapExactTokensForTokens(
                amount,
                minAmountOut,
                path,
                address(this),
                deadline
            );
            
            amountReceived = amounts[amounts.length - 1];
            if (amountReceived < minAmountOut) {
                revert SwapSlippageExceeded(minAmountOut, amountReceived);
            }
            
            // Update asset balance
            assetBalances[assetIndex] += amountReceived;
            
            emit RebalanceTradeExecuted(assetIndex, amount, amountReceived, true, block.timestamp);
        } else {
            // Sell asset for USDC
            path[0] = address(assetTokens[assetIndex]);
            path[1] = address(depositToken);
            
            // Check we have enough of the asset
            if (assetBalances[assetIndex] < amount) {
                revert InsufficientLiquidity(amount, assetBalances[assetIndex]);
            }
            
            // Approve router to spend asset
            assetTokens[assetIndex].safeIncreaseAllowance(dexRouter, amount);
            
            // Execute swap
            uint256[] memory amounts = router.swapExactTokensForTokens(
                amount,
                minAmountOut,
                path,
                address(this),
                deadline
            );
            
            amountReceived = amounts[amounts.length - 1];
            if (amountReceived < minAmountOut) {
                revert SwapSlippageExceeded(minAmountOut, amountReceived);
            }
            
            // Update asset balance
            assetBalances[assetIndex] -= amount;
            
            emit RebalanceTradeExecuted(assetIndex, amount, amountReceived, false, block.timestamp);
        }
    }

    /**
     * @notice Get expected output amount for a swap (quote)
     * @param assetIndex Asset to trade
     * @param amount Amount to swap
     * @param isBuy True if buying with USDC, false if selling for USDC
     * @return expectedOut Expected output amount
     */
    function getSwapQuote(
        uint8 assetIndex,
        uint256 amount,
        bool isBuy
    ) external view returns (uint256 expectedOut) {
        if (dexRouter == address(0)) return 0;
        if (address(assetTokens[assetIndex]) == address(0)) return 0;

        IVVSRouter router = IVVSRouter(dexRouter);
        address[] memory path = new address[](2);

        if (isBuy) {
            path[0] = address(depositToken);
            path[1] = address(assetTokens[assetIndex]);
        } else {
            path[0] = address(assetTokens[assetIndex]);
            path[1] = address(depositToken);
        }

        try router.getAmountsOut(amount, path) returns (uint256[] memory amounts) {
            expectedOut = amounts[amounts.length - 1];
        } catch {
            expectedOut = 0;
        }
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
     * @dev Protected: only withdraws accumulated fees, never more than available
     *      and reserves enough for user withdrawals
     */
    function withdrawFees() external onlyRole(FEE_MANAGER_ROLE) nonReentrant {
        uint256 totalFees = accumulatedManagementFees + accumulatedPerformanceFees;
        if (totalFees == 0) return;

        uint256 usdcBalance = depositToken.balanceOf(address(this));
        
        // SECURITY: Never withdraw more than accumulated fees
        // AND ensure minimum reserve for user withdrawals (10% of NAV)
        uint256 minReserve = calculateTotalNAV() / 10; // Keep 10% reserve
        uint256 availableForFees = usdcBalance > minReserve ? usdcBalance - minReserve : 0;
        uint256 toWithdraw = totalFees > availableForFees ? availableForFees : totalFees;
        
        if (toWithdraw == 0) return;

        // Deduct from fees in order: management first, then performance
        uint256 remaining = toWithdraw;
        
        if (remaining >= accumulatedManagementFees) {
            remaining -= accumulatedManagementFees;
            accumulatedManagementFees = 0;
        } else {
            accumulatedManagementFees -= remaining;
            remaining = 0;
        }
        
        if (remaining > 0) {
            if (remaining >= accumulatedPerformanceFees) {
                accumulatedPerformanceFees = 0;
            } else {
                accumulatedPerformanceFees -= remaining;
            }
        }

        depositToken.safeTransfer(treasury, toWithdraw);

        emit FeesWithdrawn(treasury, toWithdraw, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Calculate total NAV of the pool in USDC terms
     * @dev Uses Pyth Network price feeds for accurate multi-asset valuation
     *      CRITICAL: Reverts if any asset with balance lacks a price feed
     * @return nav Total NAV in USDC (6 decimals)
     */
    function calculateTotalNAV() public view returns (uint256 nav) {
        // Start with USDC balance (6 decimals)
        nav = depositToken.balanceOf(address(this));

        // Add value of each asset using Pyth price feeds
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (assetBalances[i] == 0) continue;
            
            // CRITICAL: Asset has balance - MUST have price feed
            // Cannot skip - would undervalue portfolio and harm depositors
            if (pythPriceIds[i] == bytes32(0)) {
                revert AssetWithoutPriceFeed(i, assetBalances[i]);
            }
            
            // Get price from Pyth oracle
            (bool success, int64 price, int32 expo, uint publishTime) = _getPythPrice(i);
            if (!success) revert OracleCallFailed(i);
            
            // Verify price is valid and not stale
            if (price <= 0) revert NegativePrice(i, int256(price));
            if (block.timestamp - publishTime > priceStaleThreshold) {
                revert StalePriceData(i, publishTime, priceStaleThreshold);
            }
            
            // Pyth prices have variable exponents (typically -8 for USD pairs)
            // Convert to USDC (6 decimals) value
            // assetValue = assetBalance * price * 10^6 / 10^(assetDecimals - expo)
            uint256 assetValue = _calculateAssetValue(
                assetBalances[i],
                uint256(uint64(price)),
                assetDecimals[i],
                expo
            );
            nav += assetValue;
        }

        return nav;
    }
    
    /**
     * @notice Calculate asset value in USDC terms
     * @param balance Asset balance
     * @param price Price from Pyth (positive)
     * @param decimals Asset decimals
     * @param expo Pyth price exponent (negative = decimals)
     */
    function _calculateAssetValue(
        uint256 balance,
        uint256 price,
        uint8 decimals,
        int32 expo
    ) internal pure returns (uint256) {
        // Pyth expo is typically -8, meaning price has 8 decimals
        // We want result in USDC (6 decimals)
        // value = balance * price / 10^decimals * 10^(-expo) / 10^6
        // Simplified: value = balance * price / 10^(decimals + (-expo) - 6)
        
        uint256 scaleFactor;
        int256 totalDecimals = int256(uint256(decimals)) - int256(expo) - 6;
        
        if (totalDecimals >= 0) {
            scaleFactor = 10 ** uint256(totalDecimals);
            return balance.mulDiv(price, scaleFactor, Math.Rounding.Floor);
        } else {
            scaleFactor = 10 ** uint256(-totalDecimals);
            return balance.mulDiv(price * scaleFactor, 1, Math.Rounding.Floor);
        }
    }
    
    /**
     * @notice Safely get price from Pyth oracle with error handling
     * @param assetIndex Index of the asset
     * @return success Whether the oracle call succeeded
     * @return price The price
     * @return expo Price exponent
     * @return publishTime Timestamp of price
     */
    function _getPythPrice(uint8 assetIndex) internal view returns (
        bool success,
        int64 price,
        int32 expo,
        uint publishTime
    ) {
        if (address(pythOracle) == address(0)) {
            return (false, 0, 0, 0);
        }
        
        try pythOracle.getPriceNoOlderThan(pythPriceIds[assetIndex], priceStaleThreshold) returns (
            IPyth.Price memory priceData
        ) {
            return (true, priceData.price, priceData.expo, priceData.publishTime);
        } catch {
            return (false, 0, 0, 0);
        }
    }

    /**
     * @notice Get NAV per share
     * @return navPerShare NAV per share (6 decimals, USDC-scaled)
     * @dev Formula: (nav_6dec × WAD) / shares_18dec = 6 decimal result
     *      e.g., $0.75 per share returns 750000 (750000 / 1e6 = 0.75)
     */
    function getNavPerShare() external view returns (uint256) {
        return _calculateNavPerShare();
    }

    function _calculateNavPerShare() internal view returns (uint256) {
        // Using virtual offset for consistency with deposit/withdraw calculations
        // This prevents share price manipulation attacks
        uint256 nav = calculateTotalNAV();
        uint256 totalAssetsWithOffset = nav + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        // Result in 6 decimals (USDC-scaled): nav_6dec × WAD / shares_18dec = 6 dec
        // e.g., $1.00 per share = 1,000,000 (formatUnits with 6 decimals = 1.0)
        return totalAssetsWithOffset.mulDiv(WAD, totalSharesWithOffset, Math.Rounding.Floor);
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
            // Using virtual offset for consistency with deposit/withdraw
            uint256 nav = calculateTotalNAV();
            uint256 totalAssetsWithOffset = nav + VIRTUAL_ASSETS;
            uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
            
            // valueUSD (6 dec) = shares (18 dec) * totalAssets (6 dec) / totalShares (18 dec)
            valueUSD = shares.mulDiv(totalAssetsWithOffset, totalSharesWithOffset, Math.Rounding.Floor);
            // percentage in basis points of actual shares (excluding virtual)
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
     * @notice Pool health check - verifies accounting integrity
     * @dev Call this to detect any accounting anomalies
     * @return isHealthy True if pool accounting is correct
     * @return sharePrice Current share price in WAD (1e18 = $1)
     * @return expectedMinNav Minimum NAV based on deposits/withdrawals
     * @return actualNav Actual NAV from calculateTotalNAV()
     * @return discrepancy Difference between expected and actual (negative = underfunded)
     */
    function healthCheck() 
        external 
        view 
        returns (
            bool isHealthy,
            uint256 sharePrice,
            uint256 expectedMinNav,
            uint256 actualNav,
            int256 discrepancy
        ) 
    {
        actualNav = calculateTotalNAV();
        sharePrice = _calculateNavPerShare();
        
        // Expected minimum NAV = total deposited - total withdrawn - fees
        uint256 totalFees = accumulatedManagementFees + accumulatedPerformanceFees;
        expectedMinNav = totalDeposited > (totalWithdrawn + totalFees) 
            ? totalDeposited - totalWithdrawn - totalFees 
            : 0;
        
        // Allow 1% tolerance for rounding
        uint256 tolerance = expectedMinNav / 100;
        
        if (actualNav >= expectedMinNav) {
            discrepancy = int256(actualNav - expectedMinNav);
            isHealthy = true;
        } else {
            discrepancy = -int256(expectedMinNav - actualNav);
            isHealthy = (expectedMinNav - actualNav) <= tolerance;
        }
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

    /**
     * @notice Check if all configured oracles are healthy (fresh prices, no errors)
     * @return healthy True if all oracles are working correctly
     * @return configured Per-asset configuration status
     * @return working Per-asset oracle working status
     * @return fresh Per-asset price freshness status
     */
    function checkOracleHealth() external view returns (
        bool healthy,
        bool[NUM_ASSETS] memory configured,
        bool[NUM_ASSETS] memory working,
        bool[NUM_ASSETS] memory fresh
    ) {
        healthy = true;
        
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            configured[i] = pythPriceIds[i] != bytes32(0);
            
            if (configured[i]) {
                (bool success, int64 price, , uint publishTime) = _getPythPrice(i);
                working[i] = success && price > 0;
                fresh[i] = success && (block.timestamp - publishTime <= priceStaleThreshold);
                
                // If asset has balance, oracle MUST be working and fresh
                if (assetBalances[i] > 0) {
                    if (!working[i] || !fresh[i]) {
                        healthy = false;
                    }
                }
            }
        }
    }

    /**
     * @notice Get current prices from all configured oracles
     * @return prices Array of prices, 0 if not configured/failed
     * @return timestamps Array of last update timestamps
     */
    function getOraclePrices() external view returns (
        uint256[NUM_ASSETS] memory prices,
        uint256[NUM_ASSETS] memory timestamps
    ) {
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (pythPriceIds[i] != bytes32(0)) {
                (bool success, int64 price, , uint publishTime) = _getPythPrice(i);
                if (success && price > 0) {
                    prices[i] = uint256(uint64(price));
                    timestamps[i] = publishTime;
                }
            }
        }
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

    /**
     * @notice Set asset token address (for post-initialization configuration)
     * @param assetIndex Index of asset (0=BTC, 1=ETH, 2=SUI, 3=CRO)
     * @param token ERC20 token address
     */
    function setAssetToken(uint8 assetIndex, address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(assetIndex < NUM_ASSETS, "Invalid asset index");
        require(token != address(0), "Zero address");
        assetTokens[assetIndex] = IERC20(token);
        assetDecimals[assetIndex] = IERC20Metadata(token).decimals();
    }

    /**
     * @notice Set Pyth Network oracle contract address
     * @param _pythOracle Address of Pyth oracle (Cronos: 0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B)
     */
    function setPythOracle(address _pythOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pythOracle != address(0), "Invalid oracle");
        pythOracle = IPyth(_pythOracle);
    }

    /**
     * @notice Set Pyth price ID for an asset
     * @param assetIndex Index of asset (0=BTC, 1=ETH, 2=SUI, 3=CRO)
     * @param priceId Pyth price feed ID (bytes32)
     */
    function setPriceId(uint8 assetIndex, bytes32 priceId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(assetIndex < NUM_ASSETS, "Invalid asset index");
        pythPriceIds[assetIndex] = priceId;
        emit PriceFeedSet(assetIndex, address(0)); // Event for tracking
    }

    /**
     * @notice Set all Pyth price IDs at once
     * @param priceIds Array of 4 Pyth price feed IDs
     */
    function setAllPriceIds(bytes32[NUM_ASSETS] calldata priceIds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            if (priceIds[i] != bytes32(0)) {
                pythPriceIds[i] = priceIds[i];
                emit PriceFeedSet(i, address(0));
            }
        }
    }

    /**
     * @notice Set price staleness threshold
     * @param threshold Maximum age of price data in seconds (default: 1 hour)
     */
    function setPriceStaleThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(threshold >= 60, "Threshold too low"); // Minimum 1 minute
        require(threshold <= 86400, "Threshold too high"); // Maximum 24 hours
        priceStaleThreshold = threshold;
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
    // RESCUE FUNCTIONS (Emergency Recovery)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Rescue accidentally sent ETH/CRO to treasury
     * @dev Only callable by admin. Use for recovering stuck native tokens.
     */
    function rescueETH() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to rescue");
        (bool success, ) = payable(treasury).call{value: balance}("");
        require(success, "ETH rescue failed");
        emit TokensRescued(address(0), balance);
    }

    /**
     * @notice Rescue accidentally sent ERC20 tokens to treasury
     * @dev Cannot rescue deposit token or pool assets - only unknown tokens
     * @param token Address of the ERC20 token to rescue
     */
    function rescueToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(token != address(0), "Invalid token");
        require(token != address(depositToken), "Cannot rescue deposit token");
        
        // Prevent rescuing pool assets
        for (uint8 i = 0; i < NUM_ASSETS; i++) {
            require(token != address(assetTokens[i]), "Cannot rescue pool asset");
        }
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        
        IERC20(token).safeTransfer(treasury, balance);
        emit TokensRescued(token, balance);
    }

    // ═══════════════════════════════════════════════════════════════
    // AUTO-HEDGE MANAGEMENT (x402 Gasless)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Set the HedgeExecutor contract address
     * @param _hedgeExecutor Address of the HedgeExecutor contract
     */
    function setHedgeExecutor(address _hedgeExecutor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_hedgeExecutor == address(0)) revert ZeroAddress();
        hedgeExecutor = _hedgeExecutor;
        emit HedgeExecutorSet(_hedgeExecutor);
    }

    /**
     * @notice Configure auto-hedge settings
     * @param _enabled Enable/disable auto-hedging
     * @param _riskThresholdBps Risk level to trigger hedge (e.g., 500 = 5% drawdown)
     * @param _maxHedgeRatioBps Max % of NAV to hedge (e.g., 2500 = 25%)
     * @param _defaultLeverage Default leverage (2-10)
     * @param _cooldownSeconds Min time between auto-hedges
     */
    function setAutoHedgeConfig(
        bool _enabled,
        uint256 _riskThresholdBps,
        uint256 _maxHedgeRatioBps,
        uint256 _defaultLeverage,
        uint256 _cooldownSeconds
    ) external onlyRole(AGENT_ROLE) {
        require(_defaultLeverage >= 2 && _defaultLeverage <= 10, "Leverage must be 2-10");
        require(_maxHedgeRatioBps <= 5000, "Max hedge ratio too high"); // Max 50%
        
        autoHedgeConfig = AutoHedgeConfig({
            enabled: _enabled,
            riskThresholdBps: _riskThresholdBps,
            maxHedgeRatioBps: _maxHedgeRatioBps,
            defaultLeverage: _defaultLeverage,
            cooldownSeconds: _cooldownSeconds,
            lastAutoHedgeTime: autoHedgeConfig.lastAutoHedgeTime
        });
        
        emit AutoHedgeConfigUpdated(_enabled, _riskThresholdBps, _maxHedgeRatioBps, _defaultLeverage);
    }

    /**
     * @notice Open a hedge position for the pool (AI-managed)
     * @dev Called by AGENT_ROLE when risk conditions are met
     * @param pairIndex Asset to hedge (0=BTC, 1=ETH, etc.)
     * @param collateralAmount USDC collateral for the hedge
     * @param leverage Leverage multiplier (2-10)
     * @param isLong Direction (false = SHORT for hedging)
     * @param reason AI reasoning for opening the hedge
     */
    function openPoolHedge(
        uint8 pairIndex,
        uint256 collateralAmount,
        uint256 leverage,
        bool isLong,
        string calldata reason
    ) external payable onlyRole(AGENT_ROLE) nonReentrant whenNotPaused returns (bytes32 hedgeId) {
        if (hedgeExecutor == address(0)) revert HedgeExecutorNotSet();
        if (collateralAmount == 0) revert ZeroAmount();
        
        // Check auto-hedge cooldown
        if (autoHedgeConfig.enabled && 
            block.timestamp < autoHedgeConfig.lastAutoHedgeTime + autoHedgeConfig.cooldownSeconds) {
            revert AutoHedgeCooldownActive(autoHedgeConfig.lastAutoHedgeTime + autoHedgeConfig.cooldownSeconds);
        }
        
        // Ensure we have enough collateral
        uint256 poolBalance = depositToken.balanceOf(address(this));
        require(poolBalance >= collateralAmount, "Insufficient pool balance");
        
        // Check max hedge ratio
        uint256 nav = calculateTotalNAV();
        uint256 maxHedgeAmount = (nav * autoHedgeConfig.maxHedgeRatioBps) / BPS_DENOMINATOR;
        require(totalHedgedValue + collateralAmount <= maxHedgeAmount, "Exceeds max hedge ratio");
        
        // Generate ZK commitment for privacy
        bytes32 commitmentHash = keccak256(abi.encodePacked(
            address(this),
            pairIndex,
            collateralAmount,
            block.timestamp
        ));
        bytes32 nullifier = keccak256(abi.encodePacked(commitmentHash, block.number));
        bytes32 merkleRoot = keccak256(abi.encodePacked(commitmentHash, nullifier));
        
        // Approve HedgeExecutor to spend collateral
        depositToken.safeIncreaseAllowance(hedgeExecutor, collateralAmount);
        
        // Open hedge via HedgeExecutor (x402 gasless compatible)
        hedgeId = IHedgeExecutor(hedgeExecutor).openHedge{value: MOONLANDER_ORACLE_FEE}(
            pairIndex,
            collateralAmount,
            leverage,
            isLong,
            commitmentHash,
            nullifier,
            merkleRoot
        );
        
        // Track the hedge
        activePoolHedges.push(hedgeId);
        isPoolHedge[hedgeId] = true;
        totalHedgedValue += collateralAmount;
        autoHedgeConfig.lastAutoHedgeTime = block.timestamp;
        
        emit PoolHedgeOpened(hedgeId, pairIndex, collateralAmount, leverage, isLong, reason);
    }

    /**
     * @notice Close a pool hedge position
     * @param hedgeId ID of the hedge to close
     * @param reason AI reasoning for closing
     */
    function closePoolHedge(
        bytes32 hedgeId,
        string calldata reason
    ) external payable onlyRole(AGENT_ROLE) nonReentrant whenNotPaused {
        if (!isPoolHedge[hedgeId]) revert HedgeNotOwnedByPool(hedgeId);
        
        // Get hedge details for PnL calculation
        (,,,, uint256 collateralAmount,,,,,,,, uint8 status) = IHedgeExecutor(hedgeExecutor).hedges(hedgeId);
        require(status == 1, "Hedge not active"); // 1 = ACTIVE
        
        // Close the hedge (no oracle fee needed - HedgeExecutor handles it)
        IHedgeExecutor(hedgeExecutor).closeHedge(hedgeId);
        
        // Get realized PnL
        (,,,,,,,,,,, int256 realizedPnl,) = IHedgeExecutor(hedgeExecutor).hedges(hedgeId);
        
        // Update tracking
        isPoolHedge[hedgeId] = false;
        totalHedgedValue = totalHedgedValue > collateralAmount ? 
            totalHedgedValue - collateralAmount : 0;
        
        // Remove from active hedges array
        for (uint256 i = 0; i < activePoolHedges.length; i++) {
            if (activePoolHedges[i] == hedgeId) {
                activePoolHedges[i] = activePoolHedges[activePoolHedges.length - 1];
                activePoolHedges.pop();
                break;
            }
        }
        
        emit PoolHedgeClosed(hedgeId, realizedPnl, reason);
    }

    /**
     * @notice Get all active pool hedges
     */
    function getActivePoolHedges() external view returns (bytes32[] memory) {
        return activePoolHedges;
    }

    /**
     * @notice Get current auto-hedge configuration
     */
    function getAutoHedgeConfig() external view returns (
        bool enabled,
        uint256 riskThresholdBps,
        uint256 maxHedgeRatioBps,
        uint256 defaultLeverage,
        uint256 cooldownSeconds,
        uint256 lastAutoHedgeTime
    ) {
        AutoHedgeConfig memory config = autoHedgeConfig;
        return (
            config.enabled,
            config.riskThresholdBps,
            config.maxHedgeRatioBps,
            config.defaultLeverage,
            config.cooldownSeconds,
            config.lastAutoHedgeTime
        );
    }

    /**
     * @notice Check if pool should auto-hedge based on risk conditions
     * @dev Called by off-chain AI agent to determine if hedge is needed
     */
    function shouldAutoHedge() external view returns (bool shouldHedge, string memory reason) {
        if (!autoHedgeConfig.enabled) {
            return (false, "Auto-hedge disabled");
        }
        
        if (hedgeExecutor == address(0)) {
            return (false, "HedgeExecutor not set");
        }
        
        if (block.timestamp < autoHedgeConfig.lastAutoHedgeTime + autoHedgeConfig.cooldownSeconds) {
            return (false, "Cooldown active");
        }
        
        // Check if already at max hedge ratio
        uint256 nav = calculateTotalNAV();
        uint256 maxHedgeAmount = (nav * autoHedgeConfig.maxHedgeRatioBps) / BPS_DENOMINATOR;
        if (totalHedgedValue >= maxHedgeAmount) {
            return (false, "Max hedge ratio reached");
        }
        
        // Pool should hedge (actual risk calculation done off-chain by AI)
        return (true, "Ready to hedge");
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
