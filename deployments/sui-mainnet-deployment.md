# SUI Mainnet Deployment Record

**Date**: 2025-07-18  
**TX Digest**: `8N759RqHt1yhb3fJjFiswUzYozfA53Ezo6dZXs2R6r33`  
**Deployer**: `0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93`  
**SUI CLI**: v1.69.2 (protocol v120)  

## Package

| Item | Object ID |
|------|-----------|
| **Package** | `0x900bca6461ad24c86b83c974788b457cb76c3f6f4fd7b061c5b58cb40d974bab` |
| **UpgradeCap** | `0xf03ff76b2abb31d38ae3f7aa1f83a74d7b5323002acd5c8fc4026aa5fc5f9d4d` |

## community_pool Module

| Object | ID |
|--------|----|
| AdminCap | `0x13ce930ebffc3888e1c1376a7f6726714bc9a2e9dbe113744a02c7a44a60fce2` |
| FeeManagerCap | `0xb8b137833788796ca5e766f5f95d84d87d6594704f3aed9c3c66c60cbc0102dc` |
| RebalancerCap | `0x64be330a752e8716af1703c222f8b368c9291c54c6b9a98814de4e6f853e88ed` |

## community_pool_usdc Module

| Object | ID |
|--------|----|
| AdminCap | `0xb329669a572b1ae94bab33bbc9f2b8f5808658c2d3b5d713c49d7afbcd94176b` |
| FeeManagerCap | `0xdb8cefdd753131225c018d024ec7ed5fc3553ba13c332ea2d647deff8d34743f` |
| RebalancerCap | `0x183422a2aa99d84cd3e7a2c157130e112519e1b4be6d02799316b0352172a268` |

## community_pool_timelock Module

| Object | ID |
|--------|----|
| TimelockAdminCap | `0x3a6bf6a025e2218eb04c137dc861f887bc981750c22a005497f091267ff09861` |

## zk_proxy_vault Module

| Object | ID |
|--------|----|
| ZKProxyVaultState | `0x0c25949383bb4314e2edf5c0e59edfb0652b88cd1363c2ef846275741bc71df2` |
| AdminCap | `0xbdf535e223a04b75bebe7ae774c42846daba4cacbe62f853a9ca102e05e7dcbf` |
| GuardianCap | `0x410f392c520c95db0a9c17bbb7ed74595919bfd701b4dec1d019bdb8f6350dc1` |
| UpgraderCap | `0xd9e12400ea1a62ba665487e76b4bbfc0728facf91430af26df1ad3566e1819d9` |

## zk_verifier Module

| Object | ID |
|--------|----|
| ZKVerifierState | `0x382595a3a02bdb996586dd46ab6bec12926f4b692f9a930f193d648d6f90e6ec` |
| AdminCap | `0x639b314cca11a7d742f8155bddf93d1780c5d3c4a4e9f9d8aacbc79a59a0a520` |

## zk_hedge_commitment Module

| Object | ID |
|--------|----|
| ZKHedgeCommitmentState | `0x785b4c0b65a448d8eca3106b506a197853c827060b45aa2fc19ffb0682c9dda2` |
| AdminCap | `0x4fa0cccfc082b385a7925f0d8034767e43bd07e4d5b116bff9e91f9e65d66469` |
| RelayerCap | `0x91687d85ac69f5e6205ec4abad66cd57345080e04bd02ede7f3761505825d8bb` |

## hedge_executor Module

| Object | ID |
|--------|----|
| HedgeExecutorState | `0x8e7d11193c0c1e6afd209bcbede4664a4987e770c8a7ddfc4a712f7a0f0dd7d2` |
| AdminCap | `0xcadf45312123ea0983840820d8d1640aee417005f777fb7cecc4b98149a24db0` |

## bluefin_bridge Module

| Object | ID |
|--------|----|
| BluefinBridgeState | `0xa7a1f048885ce83b6b072fbe80574cf02e7e7ff2dd9a367038e77a9ea7b777d3` |
| AdminCap | `0xd7e791886d6244c7068229f28e6ea7637ec1dbac00322fbaae528f9413cfe134` |

## rwa_manager Module

| Object | ID |
|--------|----|
| RWAManagerState | `0x6e5b5b529e91b3ab63f9343ecb38cac0840787b1600c0fa831d46652e7729bd8` |
| AdminCap | `0x6948cdf77f49789970c7973908a610257bb11dbbe34536bae53ac233accef970` |

## payment_router Module

| Object | ID |
|--------|----|
| PaymentRouterState | `0x6563868a63e2257973d7b2a438607323682dced9fd9b58ef66f70ffb32c1e4cd` |
| AdminCap | `0xec00c074b807c6a6cd03ad0c15354151d8ad6620130c2b79c7418dd7461fe46d` |

---

## Notes

- `max_fields_in_struct = 32` on SUI mainnet protocol v120
- `community_pool.move` refactored: CommunityPoolState 41 → 27 fields (4 sub-structs: AIManagementState, RebalanceState, HedgeState, TimelockState)
- `community_pool_usdc.move` refactored: UsdcPoolState 35 → 24 fields (2 sub-structs: UsdcAIState, UsdcHedgeState)
- All caps currently owned by deployer `0x99a3...ac93`
