/**
 * @supports PP-MGR-LIB-101 (POO-2262)
 * Recorded dev-API answers (2026-10-13, read-only, nothing signed): an unsigned v6 creation plan for a
 * throwaway Manager and an unsigned Kamino supply build for the live demo Fund. Contract fixtures:
 * they pin the shapes the launch verifies before any signature.
 */
export const LIVE_UNSIGNED_PLAN = {
  status: "awaiting-signatures",
  factory: "0xe964f36Eb23E95e20049D97122f375FbFe6B40dE",
  hubChainId: 42161,
  creationNumber: "2",
  fundId: "0xcd44aaa819f557576f79d1af430478919358207353e881f236fef51e7058e957",
  core: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
  predicted: {
    hub: {
      core: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
      aaveV3Adapter: "0xeE15D9fA5C950C3898B9dB23d92648cacCf2704D",
      uniswapV3SwapAdapter: "0x7C77087606945c6b04b1AE6aF73Bf8a3ee1347cC",
      acrossBridgeAdapter: "0x631228E15eb5A7838530b0d942894D973181e3f6",
      cctpBridgeAdapter: "0x6C81e540A038fcc5eA7dE4f6e4E0408577063388",
    },
    robinhood: {
      spokeVault: "0xD258443c7146EC13B821a771016b1248b9D56859",
      uniswapV4Adapter: "0xeAB675eb3d5EB3C26CF1982842563e6d7c504112",
      uniswapV3SwapAdapter: "0x0329931a5607697A80A3a2aDB3B257248760Dd7C",
      acrossBridgeAdapter: "0xA394550120B19C7Cb98538626636Bf1fA627C3dC",
    },
  },
  solana: {
    program: "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
    fundPda: "GriYadvQVfqSRk9g9z7rJ7rvkpDY2eJQPmFApHKRKSns",
    vault: "BUpjU3FmpJyqTSzZwjnTuwDgTxcu7TnmWFzpAvy9t885",
    emitter: "4muqJU5WkqFSsvbZjJqCg1hyTwMEjW52d8wYrtApxdYy",
    usdcAta: "Bk9dHeuaiZSv8QBjzN4HmHi6FDBKPhJYzDfz5uEQijA4",
    tslaxAta: "BEYWXzQ3x3nGCsgKyp8vyF6phsom1Myj7nKjBmdHHed2",
    nvdaxAta: "JB4UC1tH3kP69Cj3jERW9HsacpZPAknwvZfDhL3wsiFA",
    wsolAta: "7gU56eyaCg6Xkmd3x452ArHPhW2ScJ3VvMCu875Rbv8e",
    managerSolanaKey: "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43",
  },
  policyHash: "0xe14c8e1aca644e06a110ddf07053d5e3b6ba3677d3867a861d65162ece485359",
  hubPolicyHash: "0x338c613213df684bc949f80845bc67ace10645936c2bc0c63aa821a3eb23381b",
  mandateHash: "0x0fffdd9988e8bc8163c387baf25bea05a758ee975a49dcc5b7b87b6f9d066024",
  nativeMandateHash: "0xfc5a10ba5242488b1ef6fa6d864d43f4eb89cfb28d05c2d096e76b67a5ba6b6b",
  binding: {
    nonce: "0",
    expiry: "1791871620",
    expiresAt: "2026-10-13T06:07:00.000Z",
    digest: "0xfb36d24b11fcddf2e10fc2a46d0c508deafa1b4b12e9178858b7cf0bdc809909",
    typedData: {
      domain: {
        name: "PoolParty Solana Fund",
        version: "6",
        chainId: 42161,
        verifyingContract: "0xe964f36Eb23E95e20049D97122f375FbFe6B40dE",
      },
      primaryType: "SolanaBootstrap",
      types: {
        SolanaBootstrap: [
          {
            name: "hubChain",
            type: "uint256",
          },
          {
            name: "core",
            type: "address",
          },
          {
            name: "mandateHash",
            type: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
          },
          {
            name: "spokeIndex",
            type: "uint16",
          },
          {
            name: "program",
            type: "bytes32",
          },
          {
            name: "fundPda",
            type: "bytes32",
          },
          {
            name: "solanaKey",
            type: "bytes32",
          },
          {
            name: "usdcAta",
            type: "bytes32",
          },
          {
            name: "tslaxAta",
            type: "bytes32",
          },
          {
            name: "nvdaxAta",
            type: "bytes32",
          },
          {
            name: "wsolAta",
            type: "bytes32",
          },
          {
            name: "nativeMandateHash",
            type: "bytes32",
          },
          {
            name: "fundId",
            type: "bytes32",
          },
          {
            name: "nonce",
            type: "uint256",
          },
          {
            name: "expiry",
            type: "uint256",
          },
        ],
      },
      message: {
        hubChain: "42161",
        core: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
        mandateHash: "0x0fffdd9988e8bc8163c387baf25bea05a758ee975a49dcc5b7b87b6f9d066024",
        policyHash: "0xe14c8e1aca644e06a110ddf07053d5e3b6ba3677d3867a861d65162ece485359",
        spokeIndex: 1,
        program: "0x5eff0c25cc327968751dcaa4c851ae7a8b7ec9ab0114eedac8ffe275d912240d",
        solanaKey: "0xdf7291c02402416b5125022578ddfb5e49864d37b7eba2a46ed7b1becbeb4b48",
        fundPda: "0xeb9bbcefe04f133ce4fdc988ba2658112655fc0a981e198281be11392dc95ef8",
        usdcAta: "0x9fa298db4bd191ac9b6b7f3d0b9a0127b75f089da65658fb87c06b3e2ac10bed",
        tslaxAta: "0x980d0c1fddbd1dabc1bc89e07b5cb75b7cf492ec6bdb496b50b4e0b8d44b8a5d",
        nvdaxAta: "0xff2a68739b249529e44553aeea804d3607fa472415cc2c026a55308d3d7e9129",
        wsolAta: "0x634261ca11f1832742809d2acb56e768bb18509ffffb19c13284571889da5c7f",
        nativeMandateHash: "0xfc5a10ba5242488b1ef6fa6d864d43f4eb89cfb28d05c2d096e76b67a5ba6b6b",
        fundId: "0xcd44aaa819f557576f79d1af430478919358207353e881f236fef51e7058e957",
        nonce: "0",
        expiry: "1791871620",
      },
    },
    authorization: {
      hubChainId: 42161,
      factory: "0xe964f36Eb23E95e20049D97122f375FbFe6B40dE",
      fund: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
      spokeAddress: "4muqJU5WkqFSsvbZjJqCg1hyTwMEjW52d8wYrtApxdYy",
      spokeChainId: "1",
      nativeMandateHash: "0xfc5a10ba5242488b1ef6fa6d864d43f4eb89cfb28d05c2d096e76b67a5ba6b6b",
      nonce: "0",
      expiry: "1791871620",
      mandateHash: "0x0fffdd9988e8bc8163c387baf25bea05a758ee975a49dcc5b7b87b6f9d066024",
      policyHash: "0xe14c8e1aca644e06a110ddf07053d5e3b6ba3677d3867a861d65162ece485359",
      spokeIndex: 1,
      program: "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
      fundPda: "GriYadvQVfqSRk9g9z7rJ7rvkpDY2eJQPmFApHKRKSns",
      usdcAta: "Bk9dHeuaiZSv8QBjzN4HmHi6FDBKPhJYzDfz5uEQijA4",
      tslaxAta: "BEYWXzQ3x3nGCsgKyp8vyF6phsom1Myj7nKjBmdHHed2",
      nvdaxAta: "JB4UC1tH3kP69Cj3jERW9HsacpZPAknwvZfDhL3wsiFA",
      wsolAta: "7gU56eyaCg6Xkmd3x452ArHPhW2ScJ3VvMCu875Rbv8e",
      fundId: "0xcd44aaa819f557576f79d1af430478919358207353e881f236fef51e7058e957",
    },
    signature: null,
  },
  swapPolicy: {
    encoded:
      "Js1jyj/pbh2WPwFgy3VCztE6U95bsRWwDdII6qyfKmvtWLaGyH3c9S5trfFYcCJDMhaezU5u7w+eoGO/l4gSrsPvqJ5PxNQmp5TAsyRR9GExycRw7w2Lb9os66QdoV1AldHaOSoNL47Qxse8D0z6yMKAtW3qoCDGHMR5cSgTRhzhU4lKlqbACyHtDPwnmNH5qenJSiwBAAAAAAAAZAAyAMgAAAA=",
    hash: "0x3c288b63f8b81ca1a08bcb32540a507b5b3a2a3f651ac1b2c495bb88434225c4",
    apiSigner: "0x26cD63ca3fe96e1D963f0160cb7542CEd13A53DE",
    limits: {
      maxAgeSeconds: 300,
      maxConfidenceBps: 100,
      crossCheckDeviationBps: 50,
      maxSlippageBps: 200,
      scopeEnabled: false,
    },
    digest: "0xa66abc7e1a69c7694b2babe3d8a415e32104b4d7879efda996ff76dea97d1938",
    typedData: {
      domain: {
        name: "Pool Party Swap Adapter",
        version: "2",
        chainId: 42161,
        verifyingContract: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
        salt: "0x5eff0c25cc327968751dcaa4c851ae7a8b7ec9ab0114eedac8ffe275d912240d",
      },
      primaryType: "SolanaSwapPolicy",
      types: {
        SolanaSwapPolicy: [
          {
            name: "fund",
            type: "bytes32",
          },
          {
            name: "bindingDigest",
            type: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
          },
        ],
      },
      message: {
        fund: "0xeb9bbcefe04f133ce4fdc988ba2658112655fc0a981e198281be11392dc95ef8",
        bindingDigest: "0xfb36d24b11fcddf2e10fc2a46d0c508deafa1b4b12e9178858b7cf0bdc809909",
        policyHash: "0x3c288b63f8b81ca1a08bcb32540a507b5b3a2a3f651ac1b2c495bb88434225c4",
      },
    },
    signature: null,
  },
  seed: {
    amount: "50000000",
    token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    allowance: "0",
    balance: "641248160",
    approveRequired: true,
    balanceSufficient: true,
  },
  transactions: {
    approve: {
      chainId: 42161,
      to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      from: "0x000000000000000000000000000000000000dEaD",
      data: "0x095ea7b3000000000000000000000000e964f36eb23e95e20049d97122f375fbfe6b40de0000000000000000000000000000000000000000000000000000000002faf080",
      value: "0",
      gas: "70642",
    },
    createFund: null,
    createSpoke: null,
  },
  robinhoodSpokeCreated: false,
  nextAction:
    "sign binding.typedData and swapPolicy.typedData with the Manager EVM wallet, then repeat this request with nextRequests.buildCreation.body plus both signatures",
  nextRequests: {
    buildCreation: {
      method: "POST",
      path: "/api/v2/funds/build-creation",
      body: {
        manager: "0x000000000000000000000000000000000000dEaD",
        managerSolanaKey: "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43",
        managementFeeBps: 500,
        performanceFeeBps: 1000,
        payoutFeeBps: 200,
        assets: ["usdc", "wsol"],
        venues: [
          {
            kind: "kamino",
            reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
          },
          {
            kind: "raydium",
            pool: "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
          },
        ],
        seedAmount: "50000000",
        spokes: ["robinhood", "solana"],
        bindingTtlSeconds: 14400,
        creationNumber: "2",
        bindingNonce: "0",
        bindingExpiry: "1791871620",
        bindingSignature: null,
        swapPolicySignature: null,
      },
    },
    discover: {
      method: "POST",
      path: "/api/v2/funds/discover",
      body: {
        core: "0x6969B964eA831C68471518Dcbb75E4605f790d19",
      },
    },
    solanaBootstrap: {
      method: "POST",
      path: "/api/v2/funds/0x6969B964eA831C68471518Dcbb75E4605f790d19/solana/bootstrap",
      body: {
        manager: "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43",
        nonce: "0",
        expiry: "1791871620",
        swapPolicy:
          "Js1jyj/pbh2WPwFgy3VCztE6U95bsRWwDdII6qyfKmvtWLaGyH3c9S5trfFYcCJDMhaezU5u7w+eoGO/l4gSrsPvqJ5PxNQmp5TAsyRR9GExycRw7w2Lb9os66QdoV1AldHaOSoNL47Qxse8D0z6yMKAtW3qoCDGHMR5cSgTRhzhU4lKlqbACyHtDPwnmNH5qenJSiwBAAAAAAAAZAAyAMgAAAA=",
      },
    },
  },
} as const;

export const LIVE_KAMINO_BUILD = {
  transaction:
    "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAEB1GVJDhcLEzybdflNTJToaf8PoB/5Bi4zXBHUBZcwuh/ln+zt1hetEM3ZWvQFgO7VXnVR3C51AserkwMw6gMbdyeyO3SLWwEHINI2977pFKto7sOsqWB0t1OpIvIUi+ueQMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAXv8MJcwyeWh1HcqkyFGueot+yasBFO7ayP/iddkSJA16KOn09rG0Wft6Z89dYlB+4mg26nT0qFjlqEA1CCNTigan1RcYe9FmNdrUBFX9wsDBJMaPIVZ1pdu6y18IAAAAaEU4y6WbtmbN+UvXcMMRkC2omMio5nAjHKOGeU/Wq9ACAwAFAiC7AgAEEAAHDQgODwkFEAECCgsRBgwUkS6OArA5op8IAAAAoIYBAAAAAAABXVno/YeR4JZH5zb+SwoyxwmJlvcf7ypTJ2TMZgoXnjUGAB4xCy4KBQEvMBgZ",
  transactionVersion: 0,
  transactionBytes: 420,
  blockhash: "822d18derLiFLq1D14QhDLFd2rKo9uy5WTmBXAEvr5Dq",
  lastValidBlockHeight: 434309728,
  computeUnitLimit: 178976,
  computeUnitsMeasured: true,
  requiredSigners: ["6VTveiPVZVM7H9BWEsUsu4ivsrPjKw9ePrLQqHaFgJaA"],
} as const;
