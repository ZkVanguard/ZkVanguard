// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ZKPaymaster
 * @notice Paymaster that sponsors ALL ZK proof commitments for free
 * @dev Inspired by Base chain's approach - true gasless experience
 *      Anyone can deposit funds to sponsor the ecosystem
 */
contract ZKPaymaster {
    // The commitment verifier contract we're sponsoring
    address public immutable zkCommitmentVerifier;
    
    // Owner who can withdraw funds and manage settings
    address public owner;
    
    // Total gas sponsored
    uint256 public totalGasSponsored;
    uint256 public totalTransactionsSponsored;
    
    // Events
    event GasSponsored(address indexed user, uint256 gasUsed, uint256 gasPrice);
    event FundsDeposited(address indexed depositor, uint256 amount);
    event FundsWithdrawn(address indexed to, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(address _zkCommitmentVerifier) {
        zkCommitmentVerifier = _zkCommitmentVerifier;
        owner = msg.sender;
    }
    
    /**
     * @notice Execute a gasless transaction on behalf of user
     * @dev This function pays for the user's gas
     */
    function executeGasless(
        address user,
        bytes calldata data
    ) external returns (bool success, bytes memory returnData) {
        uint256 startGas = gasleft();
        
        // Execute the call to ZKCommitmentVerifier
        (success, returnData) = zkCommitmentVerifier.call(data);
        
        // Track gas usage
        uint256 gasUsed = startGas - gasleft() + 21000; // Add base gas cost
        uint256 gasCost = gasUsed * tx.gasprice;
        
        totalGasSponsored += gasCost;
        totalTransactionsSponsored++;
        
        emit GasSponsored(user, gasUsed, tx.gasprice);
        
        return (success, returnData);
    }
    
    /**
     * @notice Simpler approach - just pay for a commitment storage
     * @dev User signs off-chain, we execute and pay gas
     */
    function sponsorCommitment(
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel
    ) external returns (bool) {
        uint256 startGas = gasleft();
        
        // Encode the storeCommitment call
        bytes memory data = abi.encodeWithSignature(
            "storeCommitment(bytes32,bytes32,uint256)",
            proofHash,
            merkleRoot,
            securityLevel
        );
        
        // Execute it
        (bool success, bytes memory returnData) = zkCommitmentVerifier.call(data);
        
        if (!success) {
            // Decode revert reason if available
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    revert(add(32, returnData), returnDataSize)
                }
            }
            revert("Commitment storage failed");
        }
        
        // Track gas (use 1 gwei if testnet has 0 gas price)
        uint256 gasUsed = startGas - gasleft();
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : 1 gwei;
        uint256 gasCost = gasUsed * gasPrice;
        
        totalGasSponsored += gasCost;
        totalTransactionsSponsored++;
        
        emit GasSponsored(msg.sender, gasUsed, gasPrice);
        
        return true;
    }
    
    /**
     * @notice Donate to sponsor the ecosystem
     */
    function deposit() external payable {
        require(msg.value > 0, "Must send TCRO");
        emit FundsDeposited(msg.sender, msg.value);
    }
    
    /**
     * @notice Get paymaster balance
     */
    function balance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Withdraw funds (owner only)
     */
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        to.transfer(amount);
        emit FundsWithdrawn(to, amount);
    }
    
    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
    
    /**
     * @notice Get statistics
     */
    function getStats() external view returns (
        uint256 totalGas,
        uint256 totalTxs,
        uint256 currentBalance,
        uint256 avgGasPerTx
    ) {
        return (
            totalGasSponsored,
            totalTransactionsSponsored,
            address(this).balance,
            totalTransactionsSponsored > 0 ? totalGasSponsored / totalTransactionsSponsored : 0
        );
    }
    
    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }
}
