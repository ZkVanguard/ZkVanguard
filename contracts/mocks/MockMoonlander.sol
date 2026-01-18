/**
 * Moonlander Mock Contract for Testing
 * 
 * This deploys a mock Moonlander contract to a local Hardhat network
 * for testing the full integration flow without real funds.
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token for testing
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 10**6); // Mint 1M USDC
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockMoonlander
 * @dev Mock Moonlander contract that simulates the Diamond proxy behavior
 */
contract MockMoonlander {
    // Storage
    IERC20 public collateral;
    address public owner;
    
    // Trade storage
    struct Trade {
        address trader;
        uint256 pairIndex;
        uint256 index;
        uint256 collateralAmount;
        uint256 positionSizeUsd;
        uint256 openPrice;
        bool isLong;
        uint256 leverage;
        uint256 tp;
        uint256 sl;
        bool isOpen;
    }
    
    // Mapping: trader => pairIndex => tradeIndex => Trade
    mapping(address => mapping(uint256 => mapping(uint256 => Trade))) public trades;
    mapping(address => mapping(uint256 => uint256)) public openTradesCount;
    
    // Open interest tracking
    mapping(uint256 => uint256) public longOpenInterest;
    mapping(uint256 => uint256) public shortOpenInterest;
    
    // Mock prices (scaled to 10 decimals)
    mapping(uint256 => uint256) public mockPrices;
    
    // Oracle fee
    uint256 public constant ORACLE_FEE = 0.06 ether;
    
    // Events
    event TradeOpened(
        address indexed trader,
        uint256 indexed pairIndex,
        uint256 tradeIndex,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 openPrice
    );
    
    event TradeClosed(
        address indexed trader,
        uint256 indexed pairIndex,
        uint256 tradeIndex,
        int256 pnl
    );
    
    event TpSlUpdated(
        address indexed trader,
        uint256 indexed pairIndex,
        uint256 tradeIndex,
        uint256 tp,
        uint256 sl
    );
    
    event MarginAdded(
        address indexed trader,
        uint256 indexed pairIndex,
        uint256 tradeIndex,
        uint256 amount
    );
    
    constructor(address _collateral) {
        collateral = IERC20(_collateral);
        owner = msg.sender;
        
        // Set initial mock prices (scaled to 10 decimals)
        mockPrices[0] = 95000 * 10**10; // BTC ~$95,000
        mockPrices[1] = 3200 * 10**10;  // ETH ~$3,200
        mockPrices[2] = 10 * 10**8;     // CRO ~$0.10
        mockPrices[3] = 8 * 10**10;     // ATOM ~$8
        mockPrices[4] = 35 * 10**8;     // DOGE ~$0.35
        mockPrices[5] = 200 * 10**10;   // SOL ~$200
    }
    
    /**
     * @dev Open a market trade with Pyth oracle (mock version)
     * Function selector: 0x85420cc3
     */
    function openMarketTradeWithPythAndExtraFee(
        address referrer,
        uint256 pairIndex,
        address collateralToken,
        uint256 collateralAmount,
        uint256 openPrice,
        uint256 leveragedAmount,
        uint256 tp,
        uint256 sl,
        uint256 direction,
        uint256 fee,
        bytes[] calldata pythUpdateData
    ) external payable returns (uint256) {
        require(msg.value >= ORACLE_FEE, "Insufficient oracle fee");
        require(collateralAmount > 0, "Invalid collateral");
        require(pairIndex <= 12, "Invalid pair");
        
        // Transfer collateral
        require(
            collateral.transferFrom(msg.sender, address(this), collateralAmount),
            "Collateral transfer failed"
        );
        
        // Get current trade index
        uint256 tradeIndex = openTradesCount[msg.sender][pairIndex];
        
        // Calculate leverage from leveraged amount
        uint256 leverage = leveragedAmount / collateralAmount;
        if (leverage < 2) leverage = 2;
        if (leverage > 1000) leverage = 1000;
        
        // Get mock price
        uint256 currentPrice = mockPrices[pairIndex];
        if (currentPrice == 0) currentPrice = 1000 * 10**10; // Default
        
        // Store trade
        bool isLong = direction == 2;
        trades[msg.sender][pairIndex][tradeIndex] = Trade({
            trader: msg.sender,
            pairIndex: pairIndex,
            index: tradeIndex,
            collateralAmount: collateralAmount,
            positionSizeUsd: leveragedAmount,
            openPrice: currentPrice,
            isLong: isLong,
            leverage: leverage,
            tp: tp,
            sl: sl,
            isOpen: true
        });
        
        // Update counts and OI
        openTradesCount[msg.sender][pairIndex]++;
        if (isLong) {
            longOpenInterest[pairIndex] += leveragedAmount;
        } else {
            shortOpenInterest[pairIndex] += leveragedAmount;
        }
        
        emit TradeOpened(
            msg.sender,
            pairIndex,
            tradeIndex,
            isLong,
            collateralAmount,
            leverage,
            currentPrice
        );
        
        return tradeIndex;
    }
    
    /**
     * @dev Close a trade
     * Function selector: 0x73b1caa3
     */
    function closeTrade(uint256 pairIndex, uint256 tradeIndex) external {
        Trade storage trade = trades[msg.sender][pairIndex][tradeIndex];
        require(trade.isOpen, "Trade not open");
        require(trade.trader == msg.sender, "Not your trade");
        
        // Calculate PnL (simplified mock)
        uint256 currentPrice = mockPrices[pairIndex];
        int256 pnl = 0;
        
        if (trade.isLong) {
            // Long: profit if price increased
            if (currentPrice > trade.openPrice) {
                pnl = int256((currentPrice - trade.openPrice) * trade.positionSizeUsd / trade.openPrice);
            } else {
                pnl = -int256((trade.openPrice - currentPrice) * trade.positionSizeUsd / trade.openPrice);
            }
        } else {
            // Short: profit if price decreased
            if (currentPrice < trade.openPrice) {
                pnl = int256((trade.openPrice - currentPrice) * trade.positionSizeUsd / trade.openPrice);
            } else {
                pnl = -int256((currentPrice - trade.openPrice) * trade.positionSizeUsd / trade.openPrice);
            }
        }
        
        // Calculate return amount
        uint256 returnAmount = trade.collateralAmount;
        if (pnl > 0) {
            returnAmount += uint256(pnl);
        } else if (pnl < 0 && uint256(-pnl) < trade.collateralAmount) {
            returnAmount -= uint256(-pnl);
        } else {
            returnAmount = 0; // Liquidated
        }
        
        // Update OI
        if (trade.isLong) {
            longOpenInterest[pairIndex] -= trade.positionSizeUsd;
        } else {
            shortOpenInterest[pairIndex] -= trade.positionSizeUsd;
        }
        
        // Close trade
        trade.isOpen = false;
        
        // Return funds
        if (returnAmount > 0 && collateral.balanceOf(address(this)) >= returnAmount) {
            collateral.transfer(msg.sender, returnAmount);
        }
        
        emit TradeClosed(msg.sender, pairIndex, tradeIndex, pnl);
    }
    
    /**
     * @dev Update TP/SL
     * Function selector: 0x67d22d9b
     */
    function updateTradeTpAndSl(
        uint256 pairIndex,
        uint256 tradeIndex,
        uint256 tp,
        uint256 sl
    ) external {
        Trade storage trade = trades[msg.sender][pairIndex][tradeIndex];
        require(trade.isOpen, "Trade not open");
        require(trade.trader == msg.sender, "Not your trade");
        
        trade.tp = tp;
        trade.sl = sl;
        
        emit TpSlUpdated(msg.sender, pairIndex, tradeIndex, tp, sl);
    }
    
    /**
     * @dev Add margin to position
     * Function selector: 0x05a24c0f
     */
    function addMargin(
        uint256 pairIndex,
        uint256 tradeIndex,
        uint256 amount
    ) external {
        Trade storage trade = trades[msg.sender][pairIndex][tradeIndex];
        require(trade.isOpen, "Trade not open");
        require(trade.trader == msg.sender, "Not your trade");
        
        require(
            collateral.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        trade.collateralAmount += amount;
        
        emit MarginAdded(msg.sender, pairIndex, tradeIndex, amount);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    function getTrade(
        address trader,
        uint256 pairIndex,
        uint256 tradeIndex
    ) external view returns (Trade memory) {
        return trades[trader][pairIndex][tradeIndex];
    }
    
    function openInterest(uint256 pairIndex, bool isLong) external view returns (uint256) {
        return isLong ? longOpenInterest[pairIndex] : shortOpenInterest[pairIndex];
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS (for testing)
    // ═══════════════════════════════════════════════════════════════
    
    function setMockPrice(uint256 pairIndex, uint256 price) external {
        require(msg.sender == owner, "Only owner");
        mockPrices[pairIndex] = price;
    }
    
    function withdraw() external {
        require(msg.sender == owner, "Only owner");
        payable(owner).transfer(address(this).balance);
    }
}
