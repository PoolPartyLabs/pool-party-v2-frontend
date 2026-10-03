/**
 * @id PP-MGR (POO-1777, POO-1879, POO-1890; ported with POO-2119)
 * @name Robinhood Chain token list tests
 * @implements-rules-version v1
 *
 * The curated Robinhood Chain (4663) list arrived in this repository with the fund builder, because
 * Robinhood Chain is the one spoke the fund contracts name and a Mandate cannot list a token the
 * static lists do not carry. These cases pin what the builder relies on, no more: the chain's stable
 * and its wrapped ether resolve, wrapped ether is shown and found as ETH, every curated major is in
 * the data, and no address is listed twice.
 */
import { describe, expect, it } from "vitest";
import robinhood from "./data/robinhood.json";
import {
  canonicalTokenSymbol,
  findToken,
  searchTokens,
  tokensForNetwork,
  topTokens,
} from "./tokenList";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH9 = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

describe("Robinhood Chain token list", () => {
  it("carries the chain's stable, USDG, by address in any case", () => {
    expect(findToken("robinhood", USDG)?.symbol).toBe("USDG");
    expect(findToken("robinhood", USDG.toUpperCase().replace("0X", "0x"))?.symbol).toBe("USDG");
  });

  it("shows wrapped ether as ETH, like every other network", () => {
    expect(findToken("robinhood", WETH9)?.symbol).toBe("ETH");
    expect(canonicalTokenSymbol(WETH9, "WETH")).toBe("ETH");
  });

  it("finds wrapped ether when a manager types weth", () => {
    expect(searchTokens("robinhood", "weth")[0]?.address.toLowerCase()).toBe(WETH9);
  });

  it("lists every entry of the data file exactly once", () => {
    const listed = tokensForNetwork("robinhood").map((token) => token.address.toLowerCase());
    expect(listed).toHaveLength(Object.keys(robinhood).length);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("resolves every curated major, so none is silently skipped", () => {
    const majors = topTokens("robinhood");
    expect(majors).toHaveLength(10);
    expect(majors[0]?.symbol).toBe("USDG");
    expect(majors[1]?.symbol).toBe("ETH");
  });
});
