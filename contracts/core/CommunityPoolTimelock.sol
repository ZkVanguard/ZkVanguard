// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title CommunityPoolTimelock
 * @notice Timelock controller for CommunityPool admin operations
 * @dev All admin functions must go through this timelock
 * 
 * SECURITY:
 * - 48 hour minimum delay for mainnet
 * - Multiple proposers (multisig recommended)
 * - Single executor (can be zero address for permissionless)
 * 
 * USAGE:
 * 1. Deploy with proposers (multisig addresses) and executors
 * 2. Transfer DEFAULT_ADMIN_ROLE to this timelock
 * 3. All admin operations now require 48h delay
 */
contract CommunityPoolTimelock is TimelockController {
    
    /// @notice Mainnet minimum delay: 48 hours
    uint256 public constant MAINNET_MIN_DELAY = 48 hours;
    
    /// @notice Testnet minimum delay: 5 minutes (for testing)
    uint256 public constant TESTNET_MIN_DELAY = 5 minutes;
    
    /**
     * @param minDelay Minimum delay for operations (use MAINNET_MIN_DELAY for production)
     * @param proposers Addresses that can propose operations (should be multisig)
     * @param executors Addresses that can execute operations (zero address = anyone)
     * @param admin Optional admin for emergency upgrades (should be zero address in production)
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // NOTE: For mainnet, ensure:
        // 1. minDelay >= 48 hours
        // 2. proposers are multisig addresses (2-of-3 minimum)
        // 3. admin is address(0) to prevent bypass
    }
}
