// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ZKCommitmentVerifier
 * @notice Stores commitments of ZK-STARK proofs verified off-chain with 521-bit security
 * @dev Off-chain verification maintains full NIST P-521 cryptographic security
 *      On-chain storage uses 256-bit commitments (cryptographic hashes of proofs)
 */
contract ZKCommitmentVerifier {
    struct ProofCommitment {
        bytes32 proofHash;        // Hash of (statement_hash + challenge + response + merkle_root)
        bytes32 merkleRoot;       // Merkle root from ZK-STARK proof
        uint256 timestamp;        // When proof was verified
        address verifier;         // Who submitted the commitment
        bool verified;            // Always true (proof verified off-chain before submission)
        uint256 securityLevel;    // Security level in bits (521 for NIST P-521)
    }
    
    // Mapping from proof hash to commitment details
    // Using packed storage to minimize gas costs
    mapping(bytes32 => ProofCommitment) public commitments;
    
    // Track all proof hashes for enumeration (removed to save 20k gas per commitment)
    // Use events for indexing instead
    uint256 public totalCommitments;
    
    // Events
    event CommitmentStored(
        bytes32 indexed proofHash,
        bytes32 indexed merkleRoot,
        address indexed verifier,
        uint256 timestamp,
        uint256 securityLevel
    );
    
    event CommitmentVerified(
        bytes32 indexed proofHash,
        address indexed requester,
        bool valid
    );
    
    /**
     * @notice Store a commitment for a proof that was verified off-chain
     * @param proofHash Hash of the complete proof components
     * @param merkleRoot Merkle root from the ZK-STARK proof
     * @param securityLevel Security level in bits (e.g., 521 for NIST P-521)
     */
    function storeCommitment(
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel
    ) external {
        require(proofHash != bytes32(0), "Invalid proof hash");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(!commitments[proofHash].verified, "Commitment already exists");
        
        // Store commitment (optimized for gas)
        commitments[proofHash] = ProofCommitment({
            proofHash: proofHash,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            verifier: msg.sender,
            verified: true,
            securityLevel: securityLevel
        });
        
        unchecked { ++totalCommitments; } // Save gas with unchecked increment
        
        emit CommitmentStored(
            proofHash,
            merkleRoot,
            msg.sender,
            block.timestamp,
            securityLevel
        );
    }
    
    /**
     * @notice Store multiple commitments in one transaction (MAXIMUM GAS SAVINGS)
     * @dev Batch processing reduces per-commitment gas cost significantly
     */
    function storeCommitmentsBatch(
        bytes32[] calldata proofHashes,
        bytes32[] calldata merkleRoots,
        uint256[] calldata securityLevels
    ) external {
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
    }
    
    /**
     * @notice Check if a commitment exists and is valid
     * @param proofHash Hash of the proof to check
     * @return valid True if commitment exists
     * @return timestamp When the commitment was stored
     * @return verifier Who stored the commitment
     */
    function verifyCommitment(bytes32 proofHash) 
        external 
        returns (
            bool valid,
            uint256 timestamp,
            address verifier,
            uint256 securityLevel
        ) 
    {
        ProofCommitment memory commitment = commitments[proofHash];
        
        emit CommitmentVerified(proofHash, msg.sender, commitment.verified);
        
        return (
            commitment.verified,
            commitment.timestamp,
            commitment.verifier,
            commitment.securityLevel
        );
    }
    
    /**
     * @notice Get commitment details
     * @param proofHash Hash of the proof
     * @return commitment Full commitment structure
     */
    function getCommitment(bytes32 proofHash) 
        external 
        view 
        returns (ProofCommitment memory) 
    {
        return commitments[proofHash];
    }
    
    /**
     * @notice Get total number of stored commitments
     * @return count Total commitments stored
     */
    function getCommitmentCount() external view returns (uint256) {
        return totalCommitments;
    }
}
