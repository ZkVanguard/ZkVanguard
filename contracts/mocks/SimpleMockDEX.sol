// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleMockDEX
 * @dev Ultra-simple mock DEX for testing - uses hardcoded prices instead of Pyth
 * 
 * Prices (hardcoded, adjustable by owner):
 * - BTC: $100,000
 * - ETH: $2,500
 * - SUI: $3.50
 * - CRO: $0.10
 */
contract SimpleMockDEX is Ownable {
    using SafeERC20 for IERC20;
    
    IERC20 public usdc;
    
    // Asset index => token address
    mapping(uint8 => address) public assetTokens;
    
    // Asset index => price in USDC (6 decimals, e.g., 100000000000 = $100,000)
    mapping(uint8 => uint256) public assetPrices;
    
    // Asset index => decimals
    mapping(uint8 => uint8) public assetDecimals;
    
    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event PriceUpdated(uint8 indexed assetIndex, uint256 newPrice);
    
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        
        // Set default prices (in USDC with 6 decimals)
        assetPrices[0] = 100000 * 1e6;  // BTC = $100,000
        assetPrices[1] = 2500 * 1e6;    // ETH = $2,500
        assetPrices[2] = 35 * 1e5;      // SUI = $3.50
        assetPrices[3] = 1e5;           // CRO = $0.10
    }
    
    /**
     * @notice Configure an asset token
     */
    function configureAsset(uint8 assetIndex, address token, uint8 decimals, uint256 priceInUsdc) external onlyOwner {
        assetTokens[assetIndex] = token;
        assetDecimals[assetIndex] = decimals;
        assetPrices[assetIndex] = priceInUsdc;
    }
    
    /**
     * @notice Update asset price
     */
    function setPrice(uint8 assetIndex, uint256 priceInUsdc) external onlyOwner {
        assetPrices[assetIndex] = priceInUsdc;
        emit PriceUpdated(assetIndex, priceInUsdc);
    }
    
    /**
     * @notice Get expected output for a swap (VVS interface)
     */
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "Invalid path");
        
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        
        if (path[0] == address(usdc)) {
            // Buying asset with USDC
            uint8 idx = _findAssetIndex(path[1]);
            amounts[1] = _getAssetForUSdc(amountIn, idx);
        } else {
            // Selling asset for USDC
            uint8 idx = _findAssetIndex(path[0]);
            amounts[1] = _getUsdcForAsset(amountIn, idx);
        }
    }
    
    /**
     * @notice Execute swap (VVS interface)
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "Expired");
        require(path.length == 2, "Invalid path");
        
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        
        if (path[0] == address(usdc)) {
            // Buy asset with USDC
            uint8 idx = _findAssetIndex(path[1]);
            uint256 assetAmount = _getAssetForUSdc(amountIn, idx);
            require(assetAmount >= amountOutMin, "Slippage");
            amounts[1] = assetAmount;
            
            // Take USDC from sender
            usdc.safeTransferFrom(msg.sender, address(this), amountIn);
            
            // Mint asset to recipient
            IMintable(assetTokens[idx]).mint(to, assetAmount);
            
            emit Swap(msg.sender, path[0], path[1], amountIn, assetAmount);
        } else {
            // Sell asset for USDC
            uint8 idx = _findAssetIndex(path[0]);
            uint256 usdcAmount = _getUsdcForAsset(amountIn, idx);
            require(usdcAmount >= amountOutMin, "Slippage");
            amounts[1] = usdcAmount;
            
            // Burn asset from sender
            IMintable(path[0]).burn(msg.sender, amountIn);
            
            // Send USDC to recipient
            usdc.safeTransfer(to, usdcAmount);
            
            emit Swap(msg.sender, path[0], path[1], amountIn, usdcAmount);
        }
    }
    
    function _getAssetForUSdc(uint256 usdcAmount, uint8 idx) internal view returns (uint256) {
        // usdcAmount has 6 decimals
        // price is in USDC (6 decimals per whole asset)
        // assetAmount should have assetDecimals decimals
        //
        // Formula: assetAmount = usdcAmount * 10^assetDecimals / price
        uint256 price = assetPrices[idx];
        require(price > 0, "Price not set");
        uint8 dec = assetDecimals[idx];
        
        return (usdcAmount * (10 ** dec)) / price;
    }
    
    function _getUsdcForAsset(uint256 assetAmount, uint8 idx) internal view returns (uint256) {
        // assetAmount has assetDecimals decimals
        // price is USDC per whole asset (6 decimals)
        // usdcAmount should have 6 decimals
        //
        // Formula: usdcAmount = assetAmount * price / 10^assetDecimals
        uint256 price = assetPrices[idx];
        require(price > 0, "Price not set");
        uint8 dec = assetDecimals[idx];
        
        return (assetAmount * price) / (10 ** dec);
    }
    
    function _findAssetIndex(address token) internal view returns (uint8) {
        for (uint8 i = 0; i < 4; i++) {
            if (assetTokens[i] == token) return i;
        }
        revert("Asset not found");
    }
    
    /**
     * @notice Withdraw USDC reserves (for testing)
     */
    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}

interface IMintable {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}
