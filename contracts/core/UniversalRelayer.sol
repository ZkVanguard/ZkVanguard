// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title UniversalRelayer
 * @notice Universal gasless transaction relayer for ALL contract operations
 * @dev Supports meta-transactions for any contract call, making entire platform gasless
 * 
 * GASLESS FEATURES:
 * - Portfolio creation: FREE
 * - Asset deposits: FREE
 * - Rebalancing: FREE
 * - ZK proof verification: FREE
 * - Settlement execution: FREE
 * - All contract interactions: FREE
 */
contract UniversalRelayer is AccessControl, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant SPONSOR_ROLE = keccak256("SPONSOR_ROLE");
    
    // EIP-712 type hash for universal meta-transaction
    bytes32 public constant META_TX_TYPEHASH = keccak256(
        "MetaTransaction(address from,address to,uint256 value,bytes data,uint256 nonce,uint256 deadline)"
    );

    // Nonces for replay protection
    mapping(address => uint256) public nonces;

    // Gasless statistics
    uint256 public totalGaslessTransactions;
    uint256 public totalGasSaved;
    mapping(address => uint256) public userGaslessCount;
    mapping(address => uint256) public userGasSaved;

    // Sponsorship settings
    bool public sponsorshipEnabled = true;
    uint256 public maxSponsoredGas = 1000000;
    mapping(address => bool) public sponsoredContracts; // Which contracts are sponsored

    // Events
    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        address indexed relayer,
        uint256 gasUsed,
        bool success
    );

    event BatchMetaTransactionExecuted(
        uint256 count,
        uint256 totalGasSaved,
        address indexed relayer
    );

    event GasSponsorshipUsed(
        address indexed user,
        uint256 gasSaved,
        address sponsor
    );

    event ContractSponsored(
        address indexed contractAddress,
        bool sponsored
    );

    constructor(address _admin) EIP712("UniversalRelayer", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(SPONSOR_ROLE, _admin);
    }

    /**
     * @notice Execute gasless meta-transaction
     * @dev User signs transaction, relayer executes and pays gas
     * @param from User address (actual sender)
     * @param to Target contract
     * @param value ETH value to send
     * @param data Encoded function call
     * @param deadline Signature expiry
     * @param signature User's EIP-712 signature
     */
    function executeMetaTransaction(
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes calldata signature
    ) external onlyRole(RELAYER_ROLE) returns (bool success, bytes memory returnData) {
        require(block.timestamp <= deadline, "Signature expired");
        require(from != address(0), "Invalid sender");
        require(sponsoredContracts[to] || !sponsorshipEnabled, "Contract not sponsored");

        uint256 startGas = gasleft();

        // Verify signature
        bytes32 structHash = keccak256(
            abi.encode(
                META_TX_TYPEHASH,
                from,
                to,
                value,
                keccak256(data),
                nonces[from]++,
                deadline
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        require(signer == from, "Invalid signature");

        // Execute transaction
        (success, returnData) = to.call{value: value}(data);

        uint256 gasUsed = startGas - gasleft();
        uint256 gasSaved = gasUsed * tx.gasprice;

        // Update statistics
        totalGaslessTransactions++;
        totalGasSaved += gasSaved;
        userGaslessCount[from]++;
        userGasSaved[from] += gasSaved;

        emit MetaTransactionExecuted(from, to, msg.sender, gasUsed, success);
        emit GasSponsorshipUsed(from, gasSaved, msg.sender);

        return (success, returnData);
    }

    /**
     * @notice Execute batch of gasless transactions (MAXIMUM GAS SAVINGS)
     * @dev Processes multiple transactions in one call, amortizing base cost
     */
    function executeBatch(
        address[] calldata froms,
        address[] calldata tos,
        uint256[] calldata values,
        bytes[] calldata datas,
        uint256[] calldata deadlines,
        bytes[] calldata signatures
    ) external onlyRole(RELAYER_ROLE) returns (bool[] memory successes) {
        require(
            froms.length == tos.length &&
            froms.length == values.length &&
            froms.length == datas.length &&
            froms.length == deadlines.length &&
            froms.length == signatures.length,
            "Array length mismatch"
        );

        uint256 startGas = gasleft();
        successes = new bool[](froms.length);

        for (uint256 i = 0; i < froms.length; i++) {
            // Verify signature
            bytes32 structHash = keccak256(
                abi.encode(
                    META_TX_TYPEHASH,
                    froms[i],
                    tos[i],
                    values[i],
                    keccak256(datas[i]),
                    nonces[froms[i]]++,
                    deadlines[i]
                )
            );

            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = hash.recover(signatures[i]);
            require(signer == froms[i], "Invalid signature");

            // Execute transaction
            (successes[i], ) = tos[i].call{value: values[i]}(datas[i]);
            
            userGaslessCount[froms[i]]++;
        }

        uint256 totalGasUsed = startGas - gasleft();
        uint256 gasSaved = (totalGasUsed / froms.length) * froms.length * tx.gasprice;

        totalGaslessTransactions += froms.length;
        totalGasSaved += gasSaved;

        emit BatchMetaTransactionExecuted(froms.length, gasSaved, msg.sender);

        return successes;
    }

    /**
     * @notice Sponsor a contract (make all calls to it gasless)
     */
    function sponsorContract(address contractAddress, bool sponsored) 
        external 
        onlyRole(SPONSOR_ROLE) 
    {
        sponsoredContracts[contractAddress] = sponsored;
        emit ContractSponsored(contractAddress, sponsored);
    }

    /**
     * @notice Sponsor multiple contracts at once
     */
    function sponsorContracts(address[] calldata contracts, bool sponsored) 
        external 
        onlyRole(SPONSOR_ROLE) 
    {
        for (uint256 i = 0; i < contracts.length; i++) {
            sponsoredContracts[contracts[i]] = sponsored;
            emit ContractSponsored(contracts[i], sponsored);
        }
    }

    /**
     * @notice Add relayer (can execute gasless transactions)
     */
    function addRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(RELAYER_ROLE, relayer);
    }

    /**
     * @notice Add sponsor (can pay for user gas)
     */
    function addSponsor(address sponsor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(SPONSOR_ROLE, sponsor);
    }

    /**
     * @notice Toggle sponsorship system
     */
    function toggleSponsorship(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sponsorshipEnabled = enabled;
    }

    /**
     * @notice Get gasless statistics
     */
    function getGaslessStats() external view returns (
        uint256 totalTxs,
        uint256 totalSaved,
        uint256 averageSaved
    ) {
        return (
            totalGaslessTransactions,
            totalGasSaved,
            totalGaslessTransactions > 0 ? totalGasSaved / totalGaslessTransactions : 0
        );
    }

    /**
     * @notice Get user's gasless statistics
     */
    function getUserStats(address user) external view returns (
        uint256 txCount,
        uint256 gasSaved
    ) {
        return (userGaslessCount[user], userGasSaved[user]);
    }

    /**
     * @notice Get domain separator for EIP-712
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Check if contract is sponsored
     */
    function isContractSponsored(address contractAddress) external view returns (bool) {
        return sponsoredContracts[contractAddress];
    }

    /**
     * @notice Receive ETH for gas sponsorship
     */
    receive() external payable {}

    /**
     * @notice Withdraw funds (admin only)
     */
    function withdraw(address payable to, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(address(this).balance >= amount, "Insufficient balance");
        to.transfer(amount);
    }
}
