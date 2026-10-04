import { describe, expect, it } from "vitest";
import { explorerAddressUrl, explorerTxUrl } from "./explorer";

describe("chain explorer links", () => {
  // @rule R2
  it.each([
    [42161, "https://arbiscan.io"],
    [4663, "https://robinhoodchain.blockscout.com"],
  ])("preserves full mixed-case identifiers on chain %s", (chain, base) => {
    const hash = `0x${"aB".repeat(32)}`;
    const address = `0x${"Cd".repeat(20)}`;
    expect(explorerTxUrl(Number(chain), hash)).toBe(`${base}/tx/${hash}`);
    expect(explorerAddressUrl(Number(chain), address)).toBe(`${base}/address/${address}`);
  });
  // @rule R2
  it.each([1, 0, -1, Number.NaN, 421610])("does not link unknown chain %s", (chain) => {
    expect(explorerTxUrl(chain, `0x${"a".repeat(64)}`)).toBeNull();
    expect(explorerAddressUrl(chain, `0x${"b".repeat(40)}`)).toBeNull();
  });
  // @rule R2
  it.each([
    "",
    "0x123",
    `0x${"g".repeat(64)}`,
    `0x${"a".repeat(64)}/evil`,
    `0x${"a".repeat(40)}`,
  ])("rejects invalid transaction %s", (hash) => {
    expect(explorerTxUrl(42161, hash)).toBeNull();
  });
  // @rule R2
  it.each([
    "",
    "javascript:alert(1)",
    `0x${"g".repeat(40)}`,
    `0x${"a".repeat(64)}`,
  ])("rejects invalid address %s", (address) => {
    expect(explorerAddressUrl(4663, address)).toBeNull();
  });
});
