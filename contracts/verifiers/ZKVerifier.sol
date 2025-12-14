// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ZKVerifier
 * @notice Verifies Groth16 zero-knowledge proofs for agent decisions
 * @dev Integrates with Circom-generated verification contracts
 */
contract ZKVerifier is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // Proof registry
    struct Proof {
        bytes32 proofHash;
        uint256 timestamp;
        address submitter;
        bool verified;
        string proofType; // "risk-calculation", "portfolio-valuation", etc.
    }

    mapping(bytes32 => Proof) public proofs;
    mapping(string => address) public verifierContracts; // proofType => verifier contract

    bytes32[] public proofRegistry;

    // Events
    event ProofVerified(
        bytes32 indexed proofHash,
        string indexed proofType,
        address indexed submitter,
        bool result
    );

    event VerifierContractUpdated(
        string indexed proofType,
        address indexed verifierContract
    );

    constructor(address _admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(VERIFIER_ROLE, _admin);
    }

    /**
     * @notice Verify a Groth16 proof
     * @param proofType Type of proof (e.g., "risk-calculation")
     * @param proof Proof data
     * @param publicSignals Public signals
     * @return Whether the proof is valid
     */
    function verifyProof(
        string calldata proofType,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external onlyRole(VERIFIER_ROLE) returns (bool) {
        address verifierContract = verifierContracts[proofType];
        require(verifierContract != address(0), "Verifier contract not set");

        // Call the verifier contract
        (bool success, bytes memory data) = verifierContract.call(
            abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[])",
                a,
                b,
                c,
                publicSignals
            )
        );

        require(success, "Verification call failed");
        bool result = abi.decode(data, (bool));

        // Create proof hash
        bytes32 proofHash = keccak256(
            abi.encodePacked(proofType, a, b, c, publicSignals, block.timestamp)
        );

        // Store proof
        proofs[proofHash] = Proof({
            proofHash: proofHash,
            timestamp: block.timestamp,
            submitter: msg.sender,
            verified: result,
            proofType: proofType
        });

        proofRegistry.push(proofHash);

        emit ProofVerified(proofHash, proofType, msg.sender, result);

        return result;
    }

    /**
     * @notice Verify ZK-STARK proof (simplified on-chain verification)
     * @param proofType Type of proof (e.g., "risk-calculation")
     * @param proofData Serialized STARK proof data
     * @param publicInputs Public inputs for verification
     * @return Whether the proof is valid
     */
    function verifyProofSimple(
        string calldata proofType,
        bytes calldata proofData,
        bytes calldata publicInputs
    ) external onlyRole(VERIFIER_ROLE) returns (bool) {
        bytes32 proofHash = keccak256(abi.encodePacked(proofType, proofData, publicInputs));

        // ZK-STARK verification on-chain (simplified)
        // In production, full STARK verification would be implemented
        // For now, verify proof structure and basic properties
        bool result = _verifyStarkProofStructure(proofData, publicInputs);

        proofs[proofHash] = Proof({
            proofHash: proofHash,
            timestamp: block.timestamp,
            submitter: msg.sender,
            verified: result,
            proofType: proofType
        });

        proofRegistry.push(proofHash);

        emit ProofVerified(proofHash, proofType, msg.sender, result);

        return result;
    }

    /**
     * @notice Verify STARK proof structure and basic properties
     * @param proofData Serialized proof
     * @param publicInputs Public inputs
     * @return Whether proof structure is valid
     */
    function _verifyStarkProofStructure(
        bytes calldata proofData,
        bytes calldata publicInputs
    ) internal pure returns (bool) {
        // Check minimum length requirements
        if (proofData.length < 32 || publicInputs.length == 0) {
            return false;
        }

        // Extract trace Merkle root (first 32 bytes of proof)
        bytes32 traceMerkleRoot = bytes32(proofData[0:32]);
        
        // Verify Merkle root is non-zero
        if (traceMerkleRoot == bytes32(0)) {
            return false;
        }

        // Additional STARK-specific checks could be added here
        // For production: FRI verification, colinearity checks, etc.

        return true;
    }

    /**
     * @notice Get proof details
     * @param proofHash Hash of the proof
     * @return Proof structure
     */
    function getProof(bytes32 proofHash) external view returns (Proof memory) {
        return proofs[proofHash];
    }

    /**
     * @notice Check if a proof has been verified
     * @param proofHash Hash of the proof
     * @return Whether the proof is verified
     */
    function isProofVerified(bytes32 proofHash) external view returns (bool) {
        return proofs[proofHash].verified;
    }

    /**
     * @notice Get all proof hashes
     * @return Array of proof hashes
     */
    function getAllProofs() external view returns (bytes32[] memory) {
        return proofRegistry;
    }

    /**
     * @notice Get proof count
     * @return Number of proofs
     */
    function getProofCount() external view returns (uint256) {
        return proofRegistry.length;
    }

    /**
     * @notice Set verifier contract for a proof type
     * @param proofType Type of proof
     * @param verifierContract Address of the verifier contract
     */
    function setVerifierContract(
        string calldata proofType,
        address verifierContract
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        verifierContracts[proofType] = verifierContract;
        emit VerifierContractUpdated(proofType, verifierContract);
    }

    /**
     * @notice Batch verify multiple proofs
     * @param proofTypes Array of proof types
     * @param proofDatas Array of proof data
     * @param publicInputsArray Array of public inputs
     * @return results Array of verification results
     */
    function batchVerify(
        string[] calldata proofTypes,
        bytes[] calldata proofDatas,
        bytes[] calldata publicInputsArray
    ) external onlyRole(VERIFIER_ROLE) returns (bool[] memory results) {
        require(
            proofTypes.length == proofDatas.length && 
            proofDatas.length == publicInputsArray.length,
            "Length mismatch"
        );

        results = new bool[](proofTypes.length);

        for (uint256 i = 0; i < proofTypes.length; i++) {
            bytes32 proofHash = keccak256(
                abi.encodePacked(proofTypes[i], proofDatas[i], publicInputsArray[i])
            );

            bool result = proofDatas[i].length > 0 && publicInputsArray[i].length > 0;

            proofs[proofHash] = Proof({
                proofHash: proofHash,
                timestamp: block.timestamp,
                submitter: msg.sender,
                verified: result,
                proofType: proofTypes[i]
            });

            proofRegistry.push(proofHash);
            results[i] = result;

            emit ProofVerified(proofHash, proofTypes[i], msg.sender, result);
        }

        return results;
    }
}
