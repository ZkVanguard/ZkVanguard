// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title TrustedForwarder
 * @notice ERC-2771 meta-transaction forwarder for gasless commitments
 * @dev User signs message off-chain, relayer submits on-chain and pays gas
 *      This contract verifies signature and forwards call to target contract
 */
contract TrustedForwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 nonce;
        bytes data;
    }
    
    mapping(address => uint256) public nonces;
    
    address public owner;
    address public relayer;
    
    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        bytes data,
        bool success
    );
    
    constructor(address _relayer) {
        owner = msg.sender;
        relayer = _relayer;
    }
    
    /**
     * @notice Execute meta-transaction on behalf of user
     * @dev Only relayer can call this - relayer pays gas
     */
    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) external returns (bool, bytes memory) {
        require(msg.sender == relayer, "Only relayer");
        require(verify(req, signature), "Invalid signature");
        
        nonces[req.from]++;
        
        // Execute the call
        (bool success, bytes memory returnData) = req.to.call(
            abi.encodePacked(req.data, req.from)
        );
        
        emit MetaTransactionExecuted(req.from, req.to, req.data, success);
        
        return (success, returnData);
    }
    
    /**
     * @notice Verify EIP-712 signature
     */
    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                keccak256("ForwardRequest(address from,address to,uint256 nonce,bytes data)"),
                req.from,
                req.to,
                req.nonce,
                keccak256(req.data)
            ))
        ));
        
        return recoverSigner(digest, signature) == req.from;
    }
    
    function recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        
        if (v < 27) v += 27;
        
        return ecrecover(digest, v, r, s);
    }
    
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("TrustedForwarder"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }
    
    function setRelayer(address _relayer) external {
        require(msg.sender == owner, "Only owner");
        relayer = _relayer;
    }
}

/**
 * @title MetaTxCommitmentVerifier
 * @notice Commitment verifier that accepts meta-transactions (ERC-2771)
 * @dev Extracts real sender from calldata when called by trusted forwarder
 */
contract MetaTxCommitmentVerifier {
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
    
    address public trustedForwarder;
    
    event CommitmentStored(
        bytes32 indexed proofHash,
        bytes32 indexed merkleRoot,
        address indexed verifier,
        uint256 timestamp,
        uint256 securityLevel
    );
    
    constructor(address _trustedForwarder) {
        trustedForwarder = _trustedForwarder;
    }
    
    /**
     * @notice Store commitment (supports meta-transactions)
     * @dev Can be called directly OR via trusted forwarder
     */
    function storeCommitment(
        bytes32 proofHash,
        bytes32 merkleRoot,
        uint256 securityLevel
    ) external {
        address sender = _msgSender();
        
        require(proofHash != bytes32(0), "Invalid proof hash");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(!commitments[proofHash].verified, "Commitment exists");
        
        commitments[proofHash] = ProofCommitment({
            proofHash: proofHash,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            verifier: sender,
            verified: true,
            securityLevel: securityLevel
        });
        
        unchecked { ++totalCommitments; }
        
        emit CommitmentStored(
            proofHash,
            merkleRoot,
            sender,
            block.timestamp,
            securityLevel
        );
    }
    
    /**
     * @notice Batch store commitments
     */
    function storeCommitmentsBatch(
        bytes32[] calldata proofHashes,
        bytes32[] calldata merkleRoots,
        uint256[] calldata securityLevels
    ) external {
        address sender = _msgSender();
        
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
                verifier: sender,
                verified: true,
                securityLevel: securityLevel
            });
            
            emit CommitmentStored(
                proofHash,
                merkleRoot,
                sender,
                block.timestamp,
                securityLevel
            );
            
            unchecked { ++i; }
        }
        
        unchecked { totalCommitments += len; }
    }
    
    /**
     * @notice Get real sender (ERC-2771)
     * @dev If called by trusted forwarder, extract sender from calldata
     */
    function _msgSender() internal view returns (address sender) {
        if (msg.sender == trustedForwarder && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
    
    function verifyCommitment(bytes32 proofHash) external view returns (ProofCommitment memory) {
        return commitments[proofHash];
    }
    
    function getCommitmentCount() external view returns (uint256) {
        return totalCommitments;
    }
}
