import { type Address, address } from "@solana/kit";

export const SOLANA_TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SOLANA_TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const RAYDIUM_CLMM_PROGRAM = address("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

export interface SolanaLpToken {
  symbol: "TSLAx" | "NVDAx" | "SOL" | "USDC";
  mint: Address;
  tokenProgram: Address;
  decimals: number;
}
export interface SolanaLpChoice {
  id: "tslax-usdc" | "nvdax-usdc" | "sol-usdc";
  label: "TSLAx/USDC" | "NVDAx/USDC" | "SOL/USDC";
  poolId: Address;
  programId: Address;
  feeTierBps: number;
  tokens: readonly [SolanaLpToken, SolanaLpToken];
  stockMarketHoursRequired: boolean;
}
const usdc: SolanaLpToken = Object.freeze({
  symbol: "USDC",
  mint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  tokenProgram: SOLANA_TOKEN_PROGRAM,
  decimals: 6,
});

/** DEC-193, DEC-198: #48 NVDAx custody matches this catalog; admission/oracles are runtime gates. */
export const SOLANA_LP_CHOICES: readonly SolanaLpChoice[] = Object.freeze(
  (
    [
      {
        id: "tslax-usdc",
        label: "TSLAx/USDC",
        poolId: address("8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF"),
        programId: RAYDIUM_CLMM_PROGRAM,
        feeTierBps: 10,
        tokens: [
          {
            symbol: "TSLAx",
            mint: address("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"),
            tokenProgram: SOLANA_TOKEN_2022_PROGRAM,
            decimals: 8,
          },
          usdc,
        ],
        stockMarketHoursRequired: true,
      },
      {
        id: "nvdax-usdc",
        label: "NVDAx/USDC",
        poolId: address("49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6"),
        programId: RAYDIUM_CLMM_PROGRAM,
        feeTierBps: 10,
        tokens: [
          {
            symbol: "NVDAx",
            mint: address("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
            tokenProgram: SOLANA_TOKEN_2022_PROGRAM,
            decimals: 8,
          },
          usdc,
        ],
        stockMarketHoursRequired: true,
      },
      {
        id: "sol-usdc",
        label: "SOL/USDC",
        poolId: address("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv"),
        programId: RAYDIUM_CLMM_PROGRAM,
        feeTierBps: 4,
        tokens: [
          {
            symbol: "SOL",
            mint: address("So11111111111111111111111111111111111111112"),
            tokenProgram: SOLANA_TOKEN_PROGRAM,
            decimals: 9,
          },
          usdc,
        ],
        stockMarketHoursRequired: false,
      },
    ] satisfies SolanaLpChoice[]
  ).map((choice) =>
    Object.freeze({
      ...choice,
      tokens: Object.freeze([
        Object.freeze(choice.tokens[0]),
        Object.freeze(choice.tokens[1]),
      ] as const),
    }),
  ),
);

export function requireSolanaLpChoice(poolId: string): SolanaLpChoice {
  const choice = SOLANA_LP_CHOICES.find((entry) => entry.poolId === poolId);
  if (!choice) throw new Error("SOLANA_LP_POOL_NOT_ADMITTED");
  return choice;
}
