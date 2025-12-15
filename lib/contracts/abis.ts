/**
 * RWAManager Contract ABI
 * Key functions for portfolio management
 */

export const RWA_MANAGER_ABI = [
  {
    type: 'function',
    name: 'createPortfolio',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_targetYield', type: 'uint256' },
      { name: '_riskTolerance', type: 'uint256' },
    ],
    outputs: [{ name: 'portfolioId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPortfolio',
    stateMutability: 'view',
    inputs: [{ name: '_portfolioId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'totalValue', type: 'uint256' },
          { name: 'targetYield', type: 'uint256' },
          { name: 'riskTolerance', type: 'uint256' },
          { name: 'lastRebalance', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'assets', type: 'address[]' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'portfolioCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'depositAsset',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_portfolioId', type: 'uint256' },
      { name: '_asset', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'PortfolioCreated',
    inputs: [
      { name: 'portfolioId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'initialValue', type: 'uint256', indexed: false },
      { name: 'targetYield', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ZK_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'verifyProof',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proofType', type: 'string' },
      { name: 'a', type: 'uint256[2]' },
      { name: 'b', type: 'uint256[2][2]' },
      { name: 'c', type: 'uint256[2]' },
      { name: 'publicSignals', type: 'uint256[]' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isProofTypeSupported',
    stateMutability: 'view',
    inputs: [{ name: 'proofType', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const PAYMENT_ROUTER_ABI = [
  {
    type: 'function',
    name: 'processSettlement',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_portfolioId', type: 'uint256' },
      { name: '_payments', type: 'tuple[]', components: [
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'token', type: 'address' },
      ]},
    ],
    outputs: [],
  },
] as const;
