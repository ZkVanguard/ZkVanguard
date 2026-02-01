// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ZKPaymaster - CHEAPEST True Gasless Solution
 * @notice Simple meta-transaction forwarder with gas sponsorship
 * @dev NO external bundler needed - we run our own minimal relayer (free)
 * 
 * Architecture:
 * 1. User signs EIP-712 typed message (FREE - just signature)
 * 2. Our backend submits tx to this contract (we pay gas)
 * 3. Contract refunds our backend from its balance
 * 4. Contract executes user's intended action
 * 
 * Cost Breakdown:
 * - User: $0.00 (just signs message)
 * - Backend: $0.00 (gets refunded by contract)
 * - Contract: Uses its CRO balance (funded from faucet on testnet = FREE)
 * 
 * TOTAL COST: $0.00 on testnet
 */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ZKPaymaster is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    // ============================================
    // STORAGE
    // ============================================
    
    address public owner;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public trustedRelayers;
    
    // ZK Commitment storage
    struct ProofCommitment {
        bytes32 proofHash;
        bytes32 merkleRoot;
        uint256 timestamp;
        address verifier;
        bool verified;
        uint256 securityLevel;
    }
    mapping(bytes32 => ProofCommitment) public commitments;
    uint256 public totalCommitments;
    
    // Statistics
    uint256 public totalGasSponsored;
    uint256 public totalTransactionsRelayed;

    // ============================================
    // EVENTS
    // ============================================
    
    event MetaTransactionExecuted(
        address indexed user,
        address indexed relayer,
        uint256 nonce,
        uint256 gasSponsored
    );
    
    event CommitmentStored(
        bytes32 indexed proofHash,
        bytes32 indexed merkleRoot,
        address indexed verifier,
        uint256 timestamp,
        uint256 securityLevel
    );
    
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);

    // ============================================
    // EIP-712 TYPE HASHES
    // ============================================
    
    bytes32 private constant STORE_COMMITMENT_TYPEHASH = keccak256(
        "StoreCommitment(address user,bytes32 proofHash,bytes32 merkleRoot,uint256 securityLevel,uint256 nonce,uint256 deadline)"
    );

    // ============================================
    // MODIFIERS
    // ============================================
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyRelayer() {
        require(trustedRelayers[msg.sender] || msg.sender == owner, "Not authorized relayer");
        _;
    }

    // ============================================
    // CONSTRUCTOR
    // ============================================
    
    constructor() EIP712("ZKPaymaster", "1") {
        owner = msg.sender;
        trustedRelayers[msg.sender] = true;
    }

    // ============================================
    // RECEIVE FUNCTION (to accept CRO funding)
    // ============================================
    
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ============================================
    // META-TRANSACTION: Store ZK Commitment (GASLESS)
    // ============================================
    
    /**
     * @notice Store ZK commitment with TRUE gasless via meta-transaction
     * @dev User signs message, relayer submits, contract pays gas
     * 
     * @param user Address of the user who signed
     * @param proofHash Hash of the ZK proof
     * @param merkleRoot Merkle root of the proof tree
     * @param securityLevel Security bits (e.g., 128, 256, 521)
     * @param deadline Timestamp after which signature expires
     * @param signature EIP-712 signature from user
     */
    function storeCommitmentGasless(
        address user,
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel,
        uint256 deadline,
        bytes calldata signature
    ) external onlyRelayer nonReentrant {
        uint256 startGas = gasleft();
        
        // Verify deadline
        require(block.timestamp <= deadline, "Signature expired");
        
        // Verify signature
        uint256 currentNonce = nonces[user];
        bytes32 structHash = keccak256(abi.encode(
            STORE_COMMITMENT_TYPEHASH,
            user,
            proofHash,
            merkleRoot,
            securityLevel,
            currentNonce,
            deadline
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == user, "Invalid signature");
        
        // Increment nonce (replay protection)
        nonces[user] = currentNonce + 1;
        
        // Store commitment
        require(proofHash != bytes32(0), "Invalid proof hash");
        require(!commitments[proofHash].verified, "Commitment exists");
        
        commitments[proofHash] = ProofCommitment({
            proofHash: proofHash,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            verifier: user,
            verified: true,
            securityLevel: securityLevel
        });
        
        totalCommitments++;
        
        emit CommitmentStored(proofHash, merkleRoot, user, block.timestamp, securityLevel);
        
        // Calculate gas used and refund relayer
        uint256 gasUsed = startGas - gasleft() + 40000; // 40k buffer for refund
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : 5000 gwei;
        uint256 refundAmount = gasUsed * gasPrice;
        
        // Refund relayer (who submitted the tx)
        if (address(this).balance >= refundAmount) {
            totalGasSponsored += refundAmount;
            totalTransactionsRelayed++;
            
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            require(success, "Refund failed");
            
            emit MetaTransactionExecuted(user, msg.sender, currentNonce, refundAmount);
        }
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================
    
    function getCommitment(bytes32 proofHash) external view returns (ProofCommitment memory) {
        return commitments[proofHash];
    }
    
    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }
    
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function getStats() external view returns (
        uint256 _totalCommitments,
        uint256 _totalGasSponsored,
        uint256 _totalTransactionsRelayed,
        uint256 _balance
    ) {
        return (
            totalCommitments,
            totalGasSponsored,
            totalTransactionsRelayed,
            address(this).balance
        );
    }

    /**
     * @notice Get EIP-712 domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    
    function addRelayer(address relayer) external onlyOwner {
        trustedRelayers[relayer] = true;
        emit RelayerAdded(relayer);
    }
    
    function removeRelayer(address relayer) external onlyOwner {
        trustedRelayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }
    
    function withdraw(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawn(owner, amount);
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
}
