/**
 * @name address.test
 * maskAddress shortens a 0x address to first-6 + last-4 with an ellipsis; short inputs pass through.
 */
import { describe, expect, it } from "vitest";
import { isEvmAddress, maskAddress, maskWalletName } from "./address";

describe("maskAddress", () => {
  it("masks a full 0x address to first 6 + last 4", () => {
    expect(maskAddress(`0x3655${"a".repeat(32)}3F77`)).toBe("0x3655…3F77");
  });

  it("returns a too-short input unchanged", () => {
    expect(maskAddress("0x1234")).toBe("0x1234");
    expect(maskAddress("")).toBe("");
  });
});

// POO-704 [R5]: mirrors pool-party-api `maskWalletAddress` (three ASCII dots + EIP-55 checksum) so a
// cleared displayName's greeting fallback reads identically to the server default.
describe("maskWalletName", () => {
  it("masks to first 6 + last 4 joined by three dots, EIP-55 checksummed", () => {
    // lowercased input is checksummed, not passed through raw (distinguishes it from maskAddress).
    expect(maskWalletName("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe("0xf39F...2266");
  });

  it("uses three ASCII dots, not the ellipsis of maskAddress", () => {
    const masked = maskWalletName("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(masked).toContain("...");
    expect(masked).not.toContain("…");
  });
});

describe("isEvmAddress", () => {
  it("accepts 0x + 40 hex, case-insensitively", () => {
    expect(isEvmAddress(`0x${"a".repeat(40)}`)).toBe(true);
    expect(isEvmAddress("0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1")).toBe(true);
    expect(isEvmAddress("0xABCDEF0000000000000000000000000000000001")).toBe(true);
  });

  it("rejects a handle, wrong length, or non-hex", () => {
    expect(isEvmAddress("carlos")).toBe(false);
    expect(isEvmAddress("0x1234")).toBe(false);
    expect(isEvmAddress(`0x${"a".repeat(41)}`)).toBe(false);
    expect(isEvmAddress(`0x${"g".repeat(40)}`)).toBe(false);
    expect(isEvmAddress("")).toBe(false);
  });
});
