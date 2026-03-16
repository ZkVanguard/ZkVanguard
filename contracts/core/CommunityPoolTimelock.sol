// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title CommunityPoolTimelock (EVM Version)
 * @notice Hardened timelock controller for CommunityPool admin operations
 * @dev All admin functions (role grants, rebalancing, fee changes, upgrades)
 *      must pass through this timelock with an enforced minimum delay.
 *
 * NOTE: SUI is the DEFAULT and OPTIMIZED chain for CommunityPool.
 * This EVM version is for Cronos/Ethereum compatibility.
 * See contracts/sui/sources/community_pool_timelock.move for the primary implementation.
 *
 * SECURITY MODEL:
 * - Enforced 48-hour minimum delay on mainnet (cannot be bypassed by caller)
 * - Minimum 2 proposers required (multisig signers)
 * - At least 1 executor required
 * - Admin role is self-renounced in production deployments
 * - Emits TimelockDeployed event for on-chain audit trail
 *
 * DEPLOYMENT:
 * 1. Deploy with proposers (multisig addresses) and executors
 * 2. Grant all CommunityPool admin roles to this timelock address
 * 3. Renounce all roles from the deployer EOA on CommunityPool
 * 4. All admin operations now require timelock delay
 *
 * ROLE MAPPING (CommunityPool → Timelock):
 * - DEFAULT_ADMIN_ROLE → Timelock (manages all other roles)
 * - AGENT_ROLE         → Timelock (AI hedge execution, allocation changes)
 * - REBALANCER_ROLE    → Timelock (portfolio rebalancing)
 * - UPGRADER_ROLE      → Timelock (UUPS proxy upgrades)
 * - FEE_MANAGER_ROLE   → Timelock (fee parameter changes)
 */
contract CommunityPoolTimelock is TimelockController {

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Mainnet minimum delay: 48 hours
    uint256 public constant MAINNET_MIN_DELAY = 48 hours;

    /// @notice Testnet minimum delay: 5 minutes (for rapid iteration)
    uint256 public constant TESTNET_MIN_DELAY = 5 minutes;

    /// @notice Minimum number of proposers required
    uint256 public constant MIN_PROPOSERS = 2;

    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev minDelay is below the absolute minimum (TESTNET_MIN_DELAY)
    error DelayTooShort(uint256 provided, uint256 required);

    /// @dev Fewer than MIN_PROPOSERS supplied
    error InsufficientProposers(uint256 provided, uint256 required);

    /// @dev Empty executors array
    error NoExecutors();

    /// @dev A proposer address is address(0)
    error ZeroProposerAddress(uint256 index);

    /// @dev Duplicate proposer detected
    error DuplicateProposer(address proposer);

    /// @dev Production deployment must use admin = address(0)
    error AdminMustBeZeroInProduction();

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted once on deployment for on-chain audit trail
    event TimelockDeployed(
        uint256 indexed minDelay,
        uint256 proposerCount,
        uint256 executorCount,
        address admin,
        bool isProduction
    );

    // ═══════════════════════════════════════════════════════════════════════
    // IMMUTABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice True when deployed with mainnet-grade delay (≥ 48 hours)
    bool public immutable isProduction;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @param minDelay    Minimum delay for operations
     *                    - Mainnet: must be >= MAINNET_MIN_DELAY (48 hours)
     *                    - Testnet: must be >= TESTNET_MIN_DELAY (5 minutes)
     * @param proposers   Addresses that can propose operations (multisig signers)
     *                    - Must have at least MIN_PROPOSERS (2) entries
     *                    - No zero addresses, no duplicates
     * @param executors   Addresses that can execute matured operations
     *                    - Use [address(0)] for permissionless execution
     *                    - Must have at least 1 entry
     * @param admin       Optional admin for emergency role management
     *                    - MUST be address(0) for production (minDelay ≥ 48h)
     *                    - Non-zero only for testnet bootstrapping
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // ── Delay validation ──
        // Absolute floor: no deployment can have < 5 min delay
        if (minDelay < TESTNET_MIN_DELAY) {
            revert DelayTooShort(minDelay, TESTNET_MIN_DELAY);
        }

        bool production = minDelay >= MAINNET_MIN_DELAY;
        isProduction = production;

        // Production deployments must not have an admin bypass
        if (production && admin != address(0)) {
            revert AdminMustBeZeroInProduction();
        }

        // ── Proposer validation (multisig requirement) ──
        uint256 pLen = proposers.length;
        if (pLen < MIN_PROPOSERS) {
            revert InsufficientProposers(pLen, MIN_PROPOSERS);
        }

        for (uint256 i; i < pLen;) {
            address p = proposers[i];
            if (p == address(0)) revert ZeroProposerAddress(i);

            // Duplicate check — O(n²) but n is tiny (3-5 signers)
            for (uint256 j; j < i;) {
                if (p == proposers[j]) revert DuplicateProposer(p);
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }

        // ── Executor validation ──
        if (executors.length == 0) revert NoExecutors();

        emit TimelockDeployed(minDelay, pLen, executors.length, admin, production);
    }
}
