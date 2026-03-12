// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPyth
 * @dev Mock Pyth oracle that returns configurable fixed prices
 * Used for testing when real Pyth prices are stale
 */
contract MockPyth is Ownable {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
    
    // priceId => Price
    mapping(bytes32 => Price) public prices;
    
    constructor() Ownable(msg.sender) {
        // Set default prices (price * 10^expo = actual price)
        // BTC: $100,000, expo = -8 => price = 10000000000000
        prices[0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43] = Price({
            price: 10000000000000, // $100,000
            conf: 5000000000,
            expo: -8,
            publishTime: block.timestamp
        });
        
        // ETH: $2,500, expo = -8 => price = 250000000000
        prices[0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace] = Price({
            price: 250000000000, // $2,500
            conf: 100000000,
            expo: -8,
            publishTime: block.timestamp
        });
        
        // SUI: $3.50, expo = -8 => price = 350000000
        prices[0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744] = Price({
            price: 350000000, // $3.50
            conf: 10000000,
            expo: -8,
            publishTime: block.timestamp
        });
        
        // CRO: $0.10, expo = -8 => price = 10000000
        prices[0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71] = Price({
            price: 10000000, // $0.10
            conf: 1000000,
            expo: -8,
            publishTime: block.timestamp
        });
    }
    
    /**
     * @notice Set price for a feed ID
     */
    function setPrice(bytes32 id, int64 _price, int32 _expo) external onlyOwner {
        prices[id] = Price({
            price: _price,
            conf: uint64(uint64(_price) / 100), // 1% confidence
            expo: _expo,
            publishTime: block.timestamp
        });
    }
    
    /**
     * @notice Refresh timestamp to prevent staleness
     */
    function refreshPrices() external {
        // Update publishTime for common price feeds
        bytes32[4] memory feeds = [
            bytes32(0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43), // BTC
            bytes32(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace), // ETH
            bytes32(0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744), // SUI
            bytes32(0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71)  // CRO
        ];
        
        for (uint i = 0; i < 4; i++) {
            if (prices[feeds[i]].price != 0) {
                prices[feeds[i]].publishTime = block.timestamp;
            }
        }
    }
    
    /**
     * @notice Get price no older than age (Pyth interface)
     */
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory) {
        Price memory p = prices[id];
        require(p.price != 0, "Price not available");
        require(block.timestamp - p.publishTime <= age, "Price too stale");
        return p;
    }
    
    /**
     * @notice Get price without staleness check (Pyth interface)
     */
    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        Price memory p = prices[id];
        require(p.price != 0, "Price not available");
        return p;
    }
    
    /**
     * @notice Get price (Pyth interface - alias)
     */
    function getPrice(bytes32 id) external view returns (Price memory) {
        return prices[id];
    }
    
    /**
     * @notice Update price feeds (Pyth interface - no-op for mock)
     */
    function updatePriceFeeds(bytes[] calldata) external payable {
        // Just refresh timestamps - mock doesn't need real data
        bytes32[4] memory feeds = [
            bytes32(0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43),
            bytes32(0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace),
            bytes32(0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744),
            bytes32(0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71)
        ];
        
        for (uint i = 0; i < 4; i++) {
            if (prices[feeds[i]].price != 0) {
                prices[feeds[i]].publishTime = block.timestamp;
            }
        }
    }
    
    /**
     * @notice Get update fee (Pyth interface)
     */
    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }
}
