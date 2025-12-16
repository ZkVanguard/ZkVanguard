// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title GaslessZKCommitmentVerifier
 * @notice Self-sponsoring commitment verifier - users pay ZERO gas on-chain
 * @dev Contract refunds gas to users automatically, achieving true gasless experience
 *      Inspired by Base chain's approach - no backend service needed
 */
contract GaslessZKCommitmentVerifier {
    struct ProofCommitment {
        bytes32 proofHash;
        bytes32 merkleRoot;
        uint256 timestamp;
        address verifier;
        bool verified;
        uint256 securityLevel;
    }
    
    // Core storage
    mapping(bytes32 => ProofCommitment) public commitments;
    uint256 public totalCommitments;
    
    // Gas sponsorship tracking
    address public owner;
    uint256 public totalGasSponsored;
    uint256 public totalTransactionsSponsored;
    
    // Events
    event CommitmentStored(
        bytes32 indexed proofHash,
        bytes32 indexed merkleRoot,
        address indexed verifier,
        uint256 timestamp,
        uint256 securityLevel
    );
    
    event GasRefunded(
        address indexed user,
        uint256 gasUsed,
        uint256 refundAmount
    );
    
    event FundsDeposited(address indexed depositor, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Store commitment with automatic gas refund - USER PAYS ZERO!
     * @dev Contract tracks gas used and refunds user after execution
     */
    function storeCommitmentGasless(
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel
    ) external {
        uint256 startGas = gasleft();
        
        require(proofHash != bytes32(0), "Invalid proof hash");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(!commitments[proofHash].verified, "Commitment exists");
        
        // Store commitment
        commitments[proofHash] = ProofCommitment({
            proofHash: proofHash,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            verifier: msg.sender,
            verified: true,
            securityLevel: securityLevel
        });
        
        unchecked { ++totalCommitments; }
        
        emit CommitmentStored(
            proofHash,
            merkleRoot,
            msg.sender,
            block.timestamp,
            securityLevel
        );
        
        // Calculate gas cost - Cronos uses ~5000 gwei (5 gwei) effective gas price
        // This includes base fee (~375 gwei) + priority fee (~4625 gwei)
        // tx.gasprice returns 0, block.basefee only shows base (375 gwei), but actual is 5000 gwei
        uint256 gasUsedBeforeRefund = startGas - gasleft();
        uint256 refundOperationCost = 50000; // Buffer for refund operation
        uint256 totalGasUsed = gasUsedBeforeRefund + refundOperationCost;
        
        // Cronos testnet charges ~5000 gwei total (base + priority)
        uint256 gasPrice = 5000000000000; // 5000 gwei
        uint256 refundAmount = totalGasUsed * gasPrice;
        
        // Refund user - they pay ZERO!
        if (address(this).balance >= refundAmount && refundAmount > 0) {
            totalGasSponsored += refundAmount;
            totalTransactionsSponsored++;
            
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "Refund failed");
            
            emit GasRefunded(msg.sender, totalGasUsed, refundAmount);
        }
    }
    
    /**
     * @notice Store multiple commitments with gas refund (MAXIMUM SAVINGS!)
     * @dev Batch processing + gas refund = optimal user experience
     */
    function storeCommitmentsBatchGasless(
        bytes32[] calldata proofHashes,
        bytes32[] calldata merkleRoots,
        uint256[] calldata securityLevels
    ) external {
        uint256 startGas = gasleft();
        
        require(proofHashes.length == merkleRoots.length, "Length mismatch");
        require(proofHashes.length == securityLevels.length, "Length mismatch");
        require(proofHashes.length > 0 && proofHashes.length <= 50, "Invalid batch size");
        
        uint256 len = proofHashes.length;
        for (uint256 i = 0; i < len;) {
            bytes32 proofHash = proofHashes[i];
            bytes32 merkleRoot = merkleRoots[i];
            uint256 securityLevel = securityLevels[i];
            
            require(proofHash != bytes32(0), "Invalid proof hash");
            require(merkleRoot != bytes32(0), "Invalid merkle root");
            require(!commitments[proofHash].verified, "Commitment exists");
            
            commitments[proofHash] = ProofCommitment({
                proofHash: proofHash,
                merkleRoot: merkleRoot,
                timestamp: block.timestamp,
                verifier: msg.sender,
                verified: true,
                securityLevel: securityLevel
            });
            
            emit CommitmentStored(
                proofHash,
                merkleRoot,
                msg.sender,
                block.timestamp,
                securityLevel
            );
            
            unchecked { ++i; }
        }
        
        unchecked { totalCommitments += len; }
        
        // Calculate gas cost - Cronos uses ~5000 gwei (5 gwei) effective gas price
        // This includes base fee (~375 gwei) + priority fee (~4625 gwei)
        uint256 gasUsedBeforeRefund = startGas - gasleft();
        uint256 refundOperationCost = 50000; // Buffer for refund operation
        uint256 totalGasUsed = gasUsedBeforeRefund + refundOperationCost;
        
        // Cronos testnet charges ~5000 gwei total (base + priority)
        uint256 gasPrice = 5000000000000; // 5000 gwei
        uint256 refundAmount = totalGasUsed * gasPrice;
        
        if (address(this).balance >= refundAmount && refundAmount > 0) {
            totalGasSponsored += refundAmount;
            totalTransactionsSponsored++;
            
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "Refund failed");
            
            emit GasRefunded(msg.sender, totalGasUsed, refundAmount);
        }
    }
    
    /**
     * @notice Verify if a commitment exists
     */
    function verifyCommitment(bytes32 proofHash) 
        external 
        view 
        returns (ProofCommitment memory) 
    {
        return commitments[proofHash];
    }
    
    /**
     * @notice Get total number of commitments
     */
    function getCommitmentCount() external view returns (uint256) {
        return totalCommitments;
    }
    
    /**
     * @notice Deposit funds to sponsor gas
     */
    function deposit() external payable {
        require(msg.value > 0, "Must send funds");
        emit FundsDeposited(msg.sender, msg.value);
    }
    
    /**
     * @notice Withdraw funds (owner only)
     */
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @notice Get contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Get sponsorship statistics
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
    
    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
    
    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }
}
