// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title CommunityPoolLib
 * @notice Library for CommunityPool calculations to reduce contract size
 * @dev Extracts NAV, price, and share calculations
 */
library CommunityPoolLib {
    using Math for uint256;
    
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant WAD = 1e18;
    uint256 public constant VIRTUAL_SHARES = 1e18;
    uint256 public constant VIRTUAL_ASSETS = 1e6;
    
    /**
     * @notice Normalize Pyth price to 8 decimal precision
     * @param price Raw Pyth price
     * @param expo Pyth exponent (negative)
     * @return Normalized price with 8 decimals
     */
    function normalizePythPrice(int64 price, int32 expo) internal pure returns (uint256) {
        if (price <= 0) return 0;
        uint256 absPrice = uint256(uint64(price));
        
        // Pyth expo is negative (e.g., -8 means 8 decimal places)
        // We want 8 decimal precision for USD values
        int32 targetDecimals = -8;
        int32 decimalDiff = expo - targetDecimals;
        
        if (decimalDiff >= 0) {
            return absPrice * (10 ** uint32(decimalDiff));
        } else {
            return absPrice / (10 ** uint32(-decimalDiff));
        }
    }
    
    /**
     * @notice Calculate asset value in USDC terms
     * @param balance Asset balance
     * @param price Price from Pyth (positive)
     * @param decimals Asset decimals
     * @param expo Pyth price exponent
     * @return Asset value in USDC (6 decimals)
     */
    function calculateAssetValue(
        uint256 balance,
        uint256 price,
        uint8 decimals,
        int32 expo
    ) internal pure returns (uint256) {
        if (balance == 0 || price == 0) return 0;
        
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
     * @notice Calculate shares to mint for a deposit
     * @param amount Deposit amount (6 decimals)
     * @param totalShares Current total shares
     * @param totalAssets Current total assets
     * @return shares Shares to mint
     */
    function calculateSharesToMint(
        uint256 amount,
        uint256 totalShares,
        uint256 totalAssets
    ) internal pure returns (uint256 shares) {
        uint256 totalAssetsWithOffset = totalAssets + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        shares = amount.mulDiv(totalSharesWithOffset, totalAssetsWithOffset, Math.Rounding.Floor);
    }
    
    /**
     * @notice Calculate USD value for shares to burn
     * @param sharesToBurn Shares to burn
     * @param totalShares Current total shares
     * @param totalAssets Current total assets
     * @return amountUSD USD value to return
     */
    function calculateWithdrawAmount(
        uint256 sharesToBurn,
        uint256 totalShares,
        uint256 totalAssets
    ) internal pure returns (uint256 amountUSD) {
        uint256 totalAssetsWithOffset = totalAssets + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        amountUSD = sharesToBurn.mulDiv(totalAssetsWithOffset, totalSharesWithOffset, Math.Rounding.Floor);
    }
    
    /**
     * @notice Calculate NAV per share
     * @param totalAssets Total NAV
     * @param totalShares Total shares outstanding
     * @return NAV per share (6 decimals)
     */
    function calculateNavPerShare(
        uint256 totalAssets,
        uint256 totalShares
    ) internal pure returns (uint256) {
        uint256 totalAssetsWithOffset = totalAssets + VIRTUAL_ASSETS;
        uint256 totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
        
        return totalAssetsWithOffset.mulDiv(WAD, totalSharesWithOffset, Math.Rounding.Floor);
    }
    
    /**
     * @notice Validate allocation sums to 100%
     * @param allocations Array of allocations in BPS
     * @param length Number of assets
     * @return True if valid
     */
    function validateAllocations(uint256[4] memory allocations, uint8 length) internal pure returns (bool) {
        uint256 total;
        for (uint8 i = 0; i < length; i++) {
            total += allocations[i];
        }
        return total == BPS_DENOMINATOR;
    }
}
