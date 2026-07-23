/**
 * @id PP-CORE-LIB-021
 * @name tokenLogo
 * @implements-rules-version v1
 *
 * Symbol-keyed token-logo resolution (POO-482 R1), the NetworkLogo (PP-CORE-CMP-041) pattern
 * applied to tokens: the blue-chip majors resolve to small PNGs committed under `public/tokens/`
 * (no CDN dependency on the common path); other symbols fall back to the static per-network token
 * list's `iconUrl` on an EXACT symbol match; anything unresolved returns undefined so the caller's
 * symbol-initial chip renders (TokenAmountRow, PP-CORE-CMP-042).
 *
 * Symbol-keyed because the positions/pools payloads carry `symbol + decimals` only.
 * PP-INTEGRATION-POINT (POO-482 R5): once the backend adds the token ADDRESS to those payloads,
 * resolution upgrades to the exact `findToken(network, address)` lookup and this symbol map becomes
 * the fallback.
 */
import { tokensForNetwork } from "./tokenList";

/**
 * Committed major-token assets (public/tokens/<symbol>.png), sourced from the token list's own
 * icon URLs. POL/MATIC alias to the WPOL art (same asset, era-dependent ticker).
 */
const MAJOR_TOKEN_LOGOS: Record<string, string> = {
  ETH: "/tokens/eth.png",
  WETH: "/tokens/weth.png",
  WBTC: "/tokens/wbtc.png",
  CBBTC: "/tokens/cbbtc.png",
  USDC: "/tokens/usdc.png",
  USDBC: "/tokens/usdbc.png",
  USDT: "/tokens/usdt.png",
  DAI: "/tokens/dai.png",
  LINK: "/tokens/link.png",
  AAVE: "/tokens/aave.png",
  WPOL: "/tokens/wpol.png",
  POL: "/tokens/wpol.png",
  MATIC: "/tokens/wpol.png",
};

/**
 * Resolve a token logo URL for a symbol (POO-482 R1): committed majors first (case-insensitive,
 * network-free), then the network token list on an exact symbol match (first icon-bearing entry),
 * else undefined (initial chip renders). Resolution is deterministic for a given symbol; where a
 * non-major symbol is duplicated across list entries (e.g. base ECO/BASED), it picks the first
 * icon-bearing match rather than a canonical one.
 */
export function resolveTokenLogo(symbol: string, network?: string): string | undefined {
  const upper = symbol.toUpperCase();
  const major = MAJOR_TOKEN_LOGOS[upper];
  if (major) return major;
  if (!network) return undefined;
  return tokensForNetwork(network).find(
    (token) => token.symbol.toUpperCase() === upper && token.iconUrl != null,
  )?.iconUrl;
}
