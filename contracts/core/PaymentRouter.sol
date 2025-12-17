// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PaymentRouter
 * @notice Handles EIP-3009 transferWithAuthorization for gasless payments via x402
 * @dev Integrates with x402 Facilitator API for batch payments
 */
contract PaymentRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FACILITATOR_ROLE = keccak256("FACILITATOR_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    // EIP-3009 typehash
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = 
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH = 
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    // Nonce tracking for replay protection
    mapping(address => mapping(bytes32 => bool)) public authorizationUsed;

    // Batch payment structure
    struct BatchPayment {
        address token;
        address from;
        address[] recipients;
        uint256[] amounts;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    // Payment record for tracking
    struct PaymentRecord {
        address token;
        address from;
        address to;
        uint256 amount;
        uint256 timestamp;
        bytes32 txHash;
        bool isGasless;
    }

    mapping(bytes32 => PaymentRecord) public payments;
    mapping(address => bytes32[]) public userPayments;

    uint256 public batchCount;
    mapping(uint256 => BatchPayment) public batches;

    // Events
    event TransferWithAuthorization(
        address indexed from,
        address indexed to,
        uint256 value,
        bytes32 indexed nonce
    );

    event BatchPaymentExecuted(
        uint256 indexed batchId,
        address indexed token,
        address indexed facilitator,
        uint256 totalAmount,
        uint256 recipientCount
    );

    event PaymentRecorded(
        bytes32 indexed paymentId,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount,
        bool isGasless
    );

    constructor(address _admin, address _facilitator) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FACILITATOR_ROLE, _facilitator);
    }

    /**
     * @notice EIP-3009 transferWithAuthorization implementation
     * @param from Payer's address
     * @param to Payee's address
     * @param value Amount to transfer
     * @param validAfter Timestamp after which the authorization is valid
     * @param validBefore Timestamp before which the authorization is valid
     * @param nonce Unique nonce
     * @param v ECDSA recovery id
     * @param r ECDSA signature r
     * @param s ECDSA signature s
     */
    function transferWithAuthorization(
        address token,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant onlyRole(FACILITATOR_ROLE) {
        require(block.timestamp > validAfter, "Authorization not yet valid");
        require(block.timestamp < validBefore, "Authorization expired");
        require(!authorizationUsed[from][nonce], "Authorization already used");

        // Verify signature
        bytes32 domainSeparator = _buildDomainSeparator();
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        
        address signer = ecrecover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        // Mark nonce as used
        authorizationUsed[from][nonce] = true;

        // Execute transfer
        IERC20(token).safeTransferFrom(from, to, value);

        // Record payment
        bytes32 paymentId = keccak256(abi.encodePacked(from, to, value, nonce, block.timestamp));
        payments[paymentId] = PaymentRecord({
            token: token,
            from: from,
            to: to,
            amount: value,
            timestamp: block.timestamp,
            txHash: blockhash(block.number - 1),
            isGasless: true
        });
        
        userPayments[from].push(paymentId);
        userPayments[to].push(paymentId);

        emit TransferWithAuthorization(from, to, value, nonce);
        emit PaymentRecorded(paymentId, from, to, token, value, true);
    }

    /**
     * @notice Execute batch payments via x402
     * @param batch Batch payment structure
     * @param signatures Array of signatures for each payment
     */
    function executeBatchPayment(
        BatchPayment calldata batch,
        bytes[] calldata signatures
    ) external nonReentrant onlyRole(FACILITATOR_ROLE) {
        require(batch.recipients.length == batch.amounts.length, "Length mismatch");
        require(batch.recipients.length == signatures.length, "Signature count mismatch");
        require(block.timestamp > batch.validAfter, "Batch not yet valid");
        require(block.timestamp < batch.validBefore, "Batch expired");

        uint256 totalAmount = 0;
        uint256 batchId = batchCount++;

        for (uint256 i = 0; i < batch.recipients.length; i++) {
            require(!authorizationUsed[batch.from][batch.nonce], "Nonce already used");
            
            // Decode signature
            (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signatures[i]);

            // Transfer with authorization
            _executeTransferWithAuth(
                batch.token,
                batch.from,
                batch.recipients[i],
                batch.amounts[i],
                batch.validAfter,
                batch.validBefore,
                keccak256(abi.encodePacked(batch.nonce, i)),
                v,
                r,
                s
            );

            totalAmount += batch.amounts[i];
        }

        batches[batchId] = batch;

        emit BatchPaymentExecuted(
            batchId,
            batch.token,
            msg.sender,
            totalAmount,
            batch.recipients.length
        );
    }

    /**
     * @notice Simple transfer (non-gasless) for agent operations
     * @param token Token address
     * @param to Recipient
     * @param amount Amount to transfer
     */
    function simpleTransfer(
        address token,
        address to,
        uint256 amount
    ) external nonReentrant onlyRole(AGENT_ROLE) {
        IERC20(token).safeTransferFrom(msg.sender, to, amount);

        bytes32 paymentId = keccak256(
            abi.encodePacked(msg.sender, to, amount, block.timestamp)
        );
        
        payments[paymentId] = PaymentRecord({
            token: token,
            from: msg.sender,
            to: to,
            amount: amount,
            timestamp: block.timestamp,
            txHash: blockhash(block.number - 1),
            isGasless: false
        });

        userPayments[msg.sender].push(paymentId);
        userPayments[to].push(paymentId);

        emit PaymentRecorded(paymentId, msg.sender, to, token, amount, false);
    }

    /**
     * @notice Get user payment history
     * @param user User address
     * @return Array of payment IDs
     */
    function getUserPayments(address user) external view returns (bytes32[] memory) {
        return userPayments[user];
    }

    /**
     * @notice Check if authorization has been used
     * @param from Payer address
     * @param nonce Nonce
     * @return Whether the authorization has been used
     */
    function isAuthorizationUsed(address from, bytes32 nonce) external view returns (bool) {
        return authorizationUsed[from][nonce];
    }

    // Internal functions
    function _executeTransferWithAuth(
        address token,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        require(!authorizationUsed[from][nonce], "Authorization already used");

        bytes32 domainSeparator = _buildDomainSeparator();
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        
        address signer = ecrecover(digest, v, r, s);
        require(signer == from, "Invalid signature");

        authorizationUsed[from][nonce] = true;
        IERC20(token).safeTransferFrom(from, to, value);

        emit TransferWithAuthorization(from, to, value, nonce);
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_SEPARATOR_TYPEHASH,
                keccak256(bytes("ZkVanguardPaymentRouter")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _splitSignature(bytes memory sig) 
        internal 
        pure 
        returns (uint8 v, bytes32 r, bytes32 s) 
    {
        require(sig.length == 65, "Invalid signature length");
        
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
