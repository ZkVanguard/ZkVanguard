// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IPyth
 * @dev Minimal Pyth interface for price queries
 */
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint publishTime;
    }
    
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory price);
    function getPrice(bytes32 id) external view returns (Price memory price);
}

/**
 * @title MockWrappedToken
 * @dev Mock ERC20 token representing wrapped assets (WBTC, WETH, etc.)
 *      Can be minted by owner or MockDEXRouter for testing
 */
contract MockWrappedToken is ERC20, Ownable {
    uint8 private _decimals;
    mapping(address => bool) public minters;
    
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimalsValue
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimalsValue;
        minters[msg.sender] = true;
    }
    
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
    
    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
    }
    
    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "Not authorized to mint");
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        require(minters[msg.sender], "Not authorized to burn");
        _burn(from, amount);
    }
}

/**
 * @title MockDEXRouter
 * @dev Mock DEX Router that simulates VVS Finance swaps using Pyth oracle prices
 * 
 * Key features:
 * - Uses Pyth Network for real-time prices
 * - Mints/burns mock tokens to simulate swaps
 * - Supports slippage protection like real DEX
 * - Compatible with CommunityPool's executeRebalanceTrade()
 */
contract MockDEXRouter is Ownable {
    using SafeERC20 for IERC20;
    
    IPyth public pythOracle;
    IERC20 public usdc;
    
    // Asset index => Mock wrapped token
    mapping(uint8 => MockWrappedToken) public assetTokens;
    
    // Asset index => Pyth price ID
    mapping(uint8 => bytes32) public pythPriceIds;
    
    // Asset decimals (BTC=8, ETH=18, CRO=18, SUI=9)
    mapping(uint8 => uint8) public assetDecimals;
    
    // Price staleness threshold (1 hour for testnet - Pyth updates are infrequent)
    uint256 public constant PRICE_STALE_THRESHOLD = 3600;
    
    // Slippage tolerance (0.5% = 50 bps)
    uint256 public constant SLIPPAGE_BPS = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    event Swap(
        address indexed sender,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    
    constructor(address _pyth, address _usdc) Ownable(msg.sender) {
        pythOracle = IPyth(_pyth);
        usdc = IERC20(_usdc);
    }
    
    /**
     * @notice Configure an asset token and its Pyth price feed
     * @param assetIndex Index (0=BTC, 1=ETH, 2=CRO, 3=SUI)
     * @param token Mock wrapped token address
     * @param priceId Pyth price feed ID
     * @param tokenDecimals Token decimals
     * @dev Caller must separately call token.setMinter(router, true) to enable minting
     */
    function configureAsset(
        uint8 assetIndex,
        address token,
        bytes32 priceId,
        uint8 tokenDecimals
    ) external onlyOwner {
        assetTokens[assetIndex] = MockWrappedToken(token);
        pythPriceIds[assetIndex] = priceId;
        assetDecimals[assetIndex] = tokenDecimals;
    }
    
    /**
     * @notice Get expected output for a swap (quote)
     * @dev Simulates VVS getAmountsOut() function
     */
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "Invalid path length");
        
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        
        address tokenIn = path[0];
        address tokenOut = path[1];
        
        if (tokenIn == address(usdc)) {
            // Buying asset with USDC
            uint8 assetIndex = _findAssetIndex(tokenOut);
            amounts[1] = _getAssetForUSDC(amountIn, assetIndex);
        } else {
            // Selling asset for USDC
            uint8 assetIndex = _findAssetIndex(tokenIn);
            amounts[1] = _getUSDCForAsset(amountIn, assetIndex);
        }
    }
    
    /**
     * @notice Execute a swap with exact input amount
     * @dev Simulates VVS swapExactTokensForTokens()
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "Expired");
        require(path.length == 2, "Invalid path length");
        
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        
        address tokenIn = path[0];
        address tokenOut = path[1];
        
        if (tokenIn == address(usdc)) {
            // Buy asset with USDC
            uint8 assetIndex = _findAssetIndex(tokenOut);
            uint256 assetAmount = _getAssetForUSDC(amountIn, assetIndex);
            
            require(assetAmount >= amountOutMin, "Insufficient output");
            amounts[1] = assetAmount;
            
            // Transfer USDC from sender (lock in router as reserve)
            usdc.safeTransferFrom(msg.sender, address(this), amountIn);
            
            // Mint asset tokens to recipient
            assetTokens[assetIndex].mint(to, assetAmount);
            
            emit Swap(msg.sender, tokenIn, tokenOut, amountIn, assetAmount);
        } else {
            // Sell asset for USDC
            uint8 assetIndex = _findAssetIndex(tokenIn);
            uint256 usdcAmount = _getUSDCForAsset(amountIn, assetIndex);
            
            require(usdcAmount >= amountOutMin, "Insufficient output");
            amounts[1] = usdcAmount;
            
            // Burn asset tokens from sender
            MockWrappedToken(tokenIn).burn(msg.sender, amountIn);
            
            // Transfer USDC to recipient (from router reserve)
            usdc.safeTransfer(to, usdcAmount);
            
            emit Swap(msg.sender, tokenIn, tokenOut, amountIn, usdcAmount);
        }
    }
    
    /**
     * @notice Calculate asset amount for given USDC (buy)
     */
    function _getAssetForUSDC(uint256 usdcAmount, uint8 assetIndex) internal view returns (uint256) {
        (int64 price, int32 expo) = _getPythPrice(assetIndex);
        
        // USDC has 6 decimals
        // Pyth price has expo decimals (typically -8)
        // asset has assetDecimals[assetIndex] decimals
        //
        // Formula derivation:
        // usdcInDollars = usdcAmount / 10^6
        // pricePerWholeAsset = price * 10^expo (USD per 1 BTC)
        // wholeAssets = usdcInDollars / pricePerWholeAsset
        // rawAssetAmount = wholeAssets * 10^assetDecimals
        //
        // Combined: assetAmount = usdcAmount * 10^(assetDecimals - 6) / (price * 10^expo)
        //         = usdcAmount * 10^(assetDecimals - 6 - expo) / price
        
        uint8 assetDec = assetDecimals[assetIndex];
        int256 totalDecimals = int256(uint256(assetDec)) - 6 - int256(expo);
        
        uint256 assetAmount;
        if (totalDecimals >= 0) {
            assetAmount = (usdcAmount * (10 ** uint256(totalDecimals))) / uint256(uint64(price));
        } else {
            assetAmount = usdcAmount / (uint256(uint64(price)) * (10 ** uint256(-totalDecimals)));
        }
        
        // Apply 0.5% fee (simulates DEX fees)
        assetAmount = assetAmount * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
        
        return assetAmount;
    }
    
    /**
     * @notice Calculate USDC amount for given asset (sell)
     */
    function _getUSDCForAsset(uint256 assetAmount, uint8 assetIndex) internal view returns (uint256) {
        (int64 price, int32 expo) = _getPythPrice(assetIndex);
        
        // usdcAmount = assetAmount * price * 10^(-expo) * 10^6 / 10^assetDecimals
        // Simplified: usdcAmount = assetAmount * price / 10^(assetDecimals + (-expo) - 6)
        
        uint8 assetDec = assetDecimals[assetIndex];
        int256 totalDecimals = int256(uint256(assetDec)) - int256(expo) - 6;
        
        uint256 usdcAmount;
        if (totalDecimals >= 0) {
            usdcAmount = (assetAmount * uint256(uint64(price))) / (10 ** uint256(totalDecimals));
        } else {
            usdcAmount = assetAmount * uint256(uint64(price)) * (10 ** uint256(-totalDecimals));
        }
        
        // Apply 0.5% fee
        usdcAmount = usdcAmount * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
        
        return usdcAmount;
    }
    
    /**
     * @notice Get price from Pyth oracle
     */
    function _getPythPrice(uint8 assetIndex) internal view returns (int64 price, int32 expo) {
        bytes32 priceId = pythPriceIds[assetIndex];
        require(priceId != bytes32(0), "Price feed not configured");
        
        IPyth.Price memory pythPrice = pythOracle.getPriceNoOlderThan(priceId, PRICE_STALE_THRESHOLD);
        require(pythPrice.price > 0, "Invalid price");
        
        return (pythPrice.price, pythPrice.expo);
    }
    
    /**
     * @notice Find asset index from token address
     */
    function _findAssetIndex(address token) internal view returns (uint8) {
        for (uint8 i = 0; i < 4; i++) {
            if (address(assetTokens[i]) == token) {
                return i;
            }
        }
        revert("Unknown token");
    }
    
    /**
     * @notice Emergency withdraw (owner only)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
    
    /**
     * @notice Fund router with USDC for sells
     */
    function fundUSDC(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }
}
