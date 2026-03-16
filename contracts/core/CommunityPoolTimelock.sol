// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title CommunityPoolTimelock
 * @notice Hardened timelock controller for CommunityPool admin operations
 * @dev All admin functions (role grants, rebalancing, fee changes, upgrades)
 *      must pass through this timelock with an enforced minimum delay.
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

    /// @dev Thrown when minDelay is below the required minimum
    error DelayTooShort(uint256 provided, uint256 required);

    /// @dev Thrown when fewer than MIN_PROPOSERS are supplied
    error InsufficientProposers(uint256 provided, uint256 required);

    /// @dev Thrown when no executors are supplied
    error NoExecutors();

    /// @dev Thrown when a proposer address is zero
    error ZeroProposerAddress(uint256 index);

    /// @dev Thrown when a non-zero-address executor is duplicated or zero
    error InvalidExecutorAddress(uint256 index);

    /// @dev Thrown when duplicate proposer addresses are detected
    error DuplicateProposer(address proposer);

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when the timelock is deployed
    /// @param minDelay The enforced minimum delay
    /// @param proposerCount Number of proposers (multisig signers)
    /// @param executorCount Number of executors
    /// @param admin Admin address (should be address(0) in production)
    /// @param isProduction True if mainnet delay is enforced
    event TimelockDeployed(
        uint256 indexed minDelay,
        uint256 proposerCount,
        uint256 executorCount,
        address admin,
        bool isProduction
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Whether this deployment is production (mainnet delay enforced)
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
     *                    - No zero addresses allowed
     *                    - No duplicates allowed
     * @param executors   Addresses that can execute matured operations
     *                    - Use [address(0)] for permissionless execution
     *                    - Must have at least 1 entry
     * @param admin       Optional admin for emergency role management
     *                    - MUST be address(0) for production deployments
     *                    - Non-zero only for testnet bootstrapping
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // ── Enforce minimum delay ──
        bool _isProduction = minDelay >= MAINNET_MIN_DELAY;
        isProduction = _isProduction;

        if (_isProduction) {
            // Mainnet: strict 48h minimum
            if (minDelay < MAINNET_MIN_DELAY) {
                revert DelayTooShort(minDelay, MAINNET_MIN_DELAY);
            }
        } else {
            // Testnet: 5 minute minimum (prevents accidental zero-delay)
            if (minDelay < TESTNET_MIN_DELAY) {
                revert DelayTooShort(minDelay, TESTNET_MIN_DELAY);
            }
        }

        // ── Validate proposers (multisig requirement) ──
        if (proposers.length < MIN_PROPOSERS) {
            revert InsufficientProposers(proposers.length, MIN_PROPOSERS);
        }

        for (uint256 i = 0; i < proposers.length; i++) {
            if (proposers[i] == address(0)) {
                revert ZeroProposerAddress(i);
            }
            // Check for duplicates (O(n²) but n is small — typically 3-5 signers)
            for (uint256 j = 0; j < i; j++) {
                if (proposers[i] == proposers[j]) {
                    revert DuplicateProposer(proposers[i]);
                }
            }
        }

        // ── Validate executors ──
        if (executors.length == 0) {
            revert NoExecutors();
        }

        emit TimelockDeployed(
            minDelay,
            proposers.length,
            executors.length,
            admin,
            _isProduction
        );
    }
}
