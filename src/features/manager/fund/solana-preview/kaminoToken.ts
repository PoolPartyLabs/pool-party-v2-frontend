/**
 * @id PP-MGR-LIB-097
 * @name kaminoToken
 * @description The token of a Kamino Lend block: the options of the panel and the token that the block keeps.
 * @linear https://linear.app/yeildbay/issue/POO-2351
 * @implements-rules-version v1 (POO-2351)
 * @analytics-events none, pure helpers.
 *
 * R4. The token select of the Kamino Lend panel always offers USDC. It offers SOL when the mandate
 * has SOL or WSOL on Solana.
 *
 * R5. The block keeps its token in `config.token`. The card shows the token, not the pair. An older
 * block has no `token`: its pair reads as a token (the first symbol of the pair), so "USDC / SOL"
 * reads as USDC and "SOL / USDC" reads as SOL. A config the panel writes keeps `pair` in step with
 * `token`, so the older readers of `pair` stay valid.
 */
import type { SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import type { MandateDraft } from "../mandateDraft";
import { WSOL_MINT } from "./solanaSchemas";

export type KaminoToken = NonNullable<SolanaLocalBlockConfig["token"]>;

/** The catalog id of the Kamino block. `SOLANA_LOCAL_CONFIGS` holds the same value. */
export const KAMINO_CATALOG_ID = "solana:mainnet-beta:kamino-supply";

/** R4: USDC always, and SOL when the mandate has SOL or WSOL on Solana. */
export function kaminoTokenOptions(draft: Pick<MandateDraft, "tokens">): KaminoToken[] {
  const hasSol = draft.tokens.some(
    (token) =>
      token.network === "solana" &&
      (token.address === WSOL_MINT || ["SOL", "WSOL"].includes(token.symbol.toUpperCase())),
  );
  return hasSol ? ["USDC", "SOL"] : ["USDC"];
}

/** R5: the token of a block. The saved token wins; an older block reads its pair. */
export function kaminoTokenOf(
  config: Pick<SolanaLocalBlockConfig, "pair" | "token"> | null,
): KaminoToken {
  if (config === null) return "USDC";
  if (config.token) return config.token;
  return config.pair === "SOL / USDC" ? "SOL" : "USDC";
}

/** R5: the config for one token, with the pair that agrees with it. */
export function kaminoConfigFor(token: KaminoToken): SolanaLocalBlockConfig {
  return {
    catalogId: KAMINO_CATALOG_ID,
    pair: token === "SOL" ? "SOL / USDC" : "USDC / SOL",
    token,
  };
}
