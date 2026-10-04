import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft, tokenKey } from "../mandateDraft";
import { toV2MandateSelection } from "../v2Mandate";
import { useV2ReviewBinding } from "./useV2ReviewBinding";

vi.mock("@/lib/media/useUploadMedia", () => ({ useUploadMedia: () => vi.fn() }));
vi.mock("../v2Mandate", () => ({
  toV2MandateSelection: vi.fn(() => ({
    chains: [{ chainId: 42161, tokens: [`0x${"12".repeat(20)}`], uniswapV4PoolIds: [] }],
    aaveV3Reserves: [],
    spokeCapPercent: null,
  })),
}));
const permitted = {
  network: "arbitrum" as const,
  address: `0x${"12".repeat(20)}`,
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: null,
  locked: false,
};
const draft = {
  ...createEmptyDraft("2026-10-04", "draft"),
  name: "Income fund demo",
  tokens: [permitted],
  caps: {
    networks: {},
    protocols: {},
    tokens: { [tokenKey(permitted)]: { noCap: true, pct: 100 } },
  },
};
const catalog = {} as Parameters<typeof useV2ReviewBinding>[0]["catalog"];
describe("headless Review contract [R1, R2, R9]", () => {
  it("rejects selections wider than the provisioning API before freezing", () => {
    const { result } = renderHook(() =>
      useV2ReviewBinding({ draft, catalog, balance: BigInt(200000000) }),
    );
    vi.mocked(toV2MandateSelection).mockReturnValueOnce({
      chains: [
        {
          chainId: 42161,
          tokens: [`0x${"12".repeat(20)}`, `0x${"34".repeat(20)}`, `0x${"56".repeat(20)}`],
          uniswapV4PoolIds: [],
        },
      ],
      aaveV3Reserves: [],
      spokeCapPercent: null,
    });
    expect(() => result.current.prepare(`0x${"34".repeat(20)}`)).toThrow();
  });
  it("maps defaults, fixed investor terms and net seed preview without rendering UI", () => {
    const { result } = renderHook(() =>
      useV2ReviewBinding({ draft, catalog, balance: BigInt(200000000) }),
    );
    expect(result.current.review.name).toBe(draft.name);
    expect(result.current.preview?.principal).toBe(BigInt(99000000));
    expect(result.current.terms).toMatchObject({
      operatingCash: "0",
      payoutHours: 72,
      access: "public",
    });
    act(() => result.current.setMax());
    expect(result.current.review.seed).toBe("200");
  });
  it("validates identity and balance before freezing exact raw amounts and bps", () => {
    const { result } = renderHook(() =>
      useV2ReviewBinding({ draft, catalog, balance: BigInt(200000000) }),
    );
    act(() => result.current.setFeePercent("managementFeeBps", "0.29"));
    expect(result.current.prepare(`0x${"34".repeat(20)}`).request).toMatchObject({
      seedAmount: "100000000",
      minFirstDeposit: "100000000",
      managementFeeBps: 29,
      payoutFeeBps: 200,
    });
    act(() => result.current.setField("name", "short"));
    expect(result.current.valid).toBe(false);
    expect(result.current.errors[0]?.messageKey).toBe("fundLaunch.validation");
    expect(() => result.current.prepare(`0x${"34".repeat(20)}`)).toThrow();
  });
  it("refuses unknown balance and stages only validated logo uploads", async () => {
    const upload = vi.fn(async () => "https://cdn.test/logo.png");
    const { result } = renderHook(() =>
      useV2ReviewBinding({ draft, catalog, balance: null, upload }),
    );
    expect(result.current.valid).toBe(false);
    await act(async () => {
      await result.current.uploadLogo(new File(["png"], "logo.png", { type: "image/png" }));
    });
    expect(result.current.review.imageUrl).toBe("https://cdn.test/logo.png");
    await act(async () => {
      await expect(
        result.current.uploadLogo(new File(["svg"], "logo.svg", { type: "image/svg+xml" })),
      ).rejects.toThrow();
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.uploadError).toBe("fundLaunch.uploadFailed");
  });
  it("reports seed bounds and malformed identity and refuses invalid fee precision", () => {
    const { result } = renderHook(() =>
      useV2ReviewBinding({ draft, catalog, balance: BigInt(200000000) }),
    );
    act(() => result.current.setField("seed", "99"));
    expect(result.current.errors[0]?.field).toBe("seed");
    expect(() => result.current.setFeePercent("payoutFeeBps", "8.001")).toThrow("INVALID_FEE");
    act(() => result.current.setField("seed", "bad"));
    expect(result.current.preview).toBeNull();
    const unknown = renderHook(() => useV2ReviewBinding({ draft, catalog, balance: null }));
    expect(() => unknown.result.current.prepare(`0x${"34".repeat(20)}`)).toThrow("INVALID_DEPOSIT");
    act(() => unknown.result.current.setMax());
    expect(unknown.result.current.review.seed).toBe("100");
  });
});
