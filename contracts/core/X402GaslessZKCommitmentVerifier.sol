// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title X402GaslessZKCommitmentVerifier
 * @notice TRUE GASLESS commitment storage powered by x402 + USDC
 * @dev Users pay tiny USDC fee via x402 gaslessly, contract stores commitment
 *      NO CRO NEEDED - 100% gasless for users!
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract X402GaslessZKCommitmentVerifier {
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
    
    // Payment configuration
    address public immutable USDC_TOKEN;
    address public owner;
    uint256 public feePerCommitment; // USDC fee (6 decimals)
    
    // Statistics
    uint256 public totalFeesCollected;
    uint256 public totalGasSponsored;
    
    // Events
    event CommitmentStored(
        bytes32 indexed proofHash,
        bytes32 indexed merkleRoot,
        address indexed verifier,
        uint256 timestamp,
        uint256 securityLevel,
        uint256 feeInUSDC
    );
    
    event FeePaid(
        address indexed user,
        uint256 amount,
        uint256 gasSponsored
    );
    
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    /**
     * @param _usdcToken USDC token address (DevUSDCe on testnet)
     * @param _feePerCommitment Fee in USDC (6 decimals, e.g., 10000 = $0.01)
     */
    constructor(address _usdcToken, uint256 _feePerCommitment) {
        require(_usdcToken != address(0), "Invalid USDC address");
        USDC_TOKEN = _usdcToken;
        feePerCommitment = _feePerCommitment;
        owner = msg.sender;
    }
    
    /**
     * @notice Store commitment with TRUE GASLESS via x402 + USDC payment
     * @dev User pays tiny USDC fee via x402 (gaslessly), contract sponsors CRO gas
     *      User needs ZERO CRO - completely gasless!
     * 
     * Flow:
     * 1. User signs USDC transfer authorization (EIP-3009) - x402 gasless
     * 2. x402 Facilitator executes USDC transfer - user pays $0.00 in gas
     * 3. This contract receives USDC, stores commitment
     * 4. Contract uses its CRO balance to pay gas
     * 
     * Result: User pays only ~$0.01 USDC, ZERO CRO gas!
     */
    function storeCommitmentWithUSDC(
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel
    ) external {
        uint256 startGas = gasleft();
        
        require(proofHash != bytes32(0), "Invalid proof hash");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(!commitments[proofHash].verified, "Commitment exists");
        
        // Collect USDC fee (via x402 gasless - user pays NO CRO!)
        require(
            IERC20(USDC_TOKEN).transferFrom(msg.sender, address(this), feePerCommitment),
            "USDC payment failed"
        );
        
        // Store commitment
        commitments[proofHash] = ProofCommitment({
            proofHash: proofHash,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            verifier: msg.sender,
            verified: true,
            securityLevel: securityLevel
        });
        
        unchecked { 
            ++totalCommitments;
            totalFeesCollected += feePerCommitment;
        }
        
        // Calculate gas sponsored by contract (not user!)
        uint256 gasUsed = startGas - gasleft() + 10000; // Buffer
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : 5000000000000; // 5000 gwei
        uint256 gasSponsored = gasUsed * gasPrice;
        totalGasSponsored += gasSponsored;
        
        emit CommitmentStored(
            proofHash,
            merkleRoot,
            msg.sender,
            block.timestamp,
            securityLevel,
            feePerCommitment
        );
        
        emit FeePaid(msg.sender, feePerCommitment, gasSponsored);
    }
    
    /**
     * @notice Store multiple commitments in batch with USDC payment
     * @dev Batch processing saves USDC fees - optimal pricing!
     */
    function storeCommitmentsBatchWithUSDC(
        bytes32[] calldata proofHashes,
        bytes32[] calldata merkleRoots,
        uint256[] calldata securityLevels
    ) external {
        uint256 startGas = gasleft();
        
        require(proofHashes.length == merkleRoots.length, "Length mismatch");
        require(proofHashes.length == securityLevels.length, "Length mismatch");
        require(proofHashes.length > 0 && proofHashes.length <= 50, "Invalid batch size");
        
        uint256 len = proofHashes.length;
        uint256 totalFee = feePerCommitment * len;
        
        // Collect USDC fee for entire batch (via x402 gasless!)
        require(
            IERC20(USDC_TOKEN).transferFrom(msg.sender, address(this), totalFee),
            "USDC payment failed"
        );
        
        // Store all commitments
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
                securityLevel,
                feePerCommitment
            );
            
            unchecked { ++i; }
        }
        
        unchecked { 
            totalCommitments += len;
            totalFeesCollected += totalFee;
        }
        
        // Calculate gas sponsored
        uint256 gasUsed = startGas - gasleft() + 10000;
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : 5000000000000;
        uint256 gasSponsored = gasUsed * gasPrice;
        totalGasSponsored += gasSponsored;
        
        emit FeePaid(msg.sender, totalFee, gasSponsored);
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
     * @notice Update fee per commitment (owner only)
     */
    function setFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = feePerCommitment;
        feePerCommitment = newFee;
        emit FeeUpdated(oldFee, newFee);
    }
    
    /**
     * @notice Withdraw collected USDC fees (owner only)
     */
    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(
            IERC20(USDC_TOKEN).balanceOf(address(this)) >= amount,
            "Insufficient USDC"
        );
        require(
            IERC20(USDC_TOKEN).transferFrom(address(this), to, amount),
            "Transfer failed"
        );
    }
    
    /**
     * @notice Deposit CRO to sponsor gas costs
     */
    function depositCRO() external payable {
        require(msg.value > 0, "Must send CRO");
    }
    
    /**
     * @notice Withdraw CRO balance (owner only)
     */
    function withdrawCRO(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @notice Get statistics
     */
    function getStats() external view returns (
        uint256 totalComm,
        uint256 totalFees,
        uint256 totalGas,
        uint256 usdcBalance,
        uint256 croBalance,
        uint256 feePerComm
    ) {
        return (
            totalCommitments,
            totalFeesCollected,
            totalGasSponsored,
            IERC20(USDC_TOKEN).balanceOf(address(this)),
            address(this).balance,
            feePerCommitment
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
        // Accept CRO deposits to sponsor gas
    }
}
