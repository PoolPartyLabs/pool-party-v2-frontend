/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapPage — route tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The route guard, which is the whole of [R1] and [R5] at this layer: `/swap` is dark-launched, so a
 * deep link 404s until `swapScreen` is flipped on, and it is guarded SERVER-side rather than merely
 * hidden from the nav.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { notFoundMock, setRequestLocaleMock } = vi.hoisted(() => ({
  // The real `notFound()` throws to unwind the render, and `requireFeature` relies on that: anything
  // after it must NOT run. A mock that merely records the call would let the page render on past a
  // failed guard and quietly assert the wrong thing.
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  setRequestLocaleMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("next-intl/server", () => ({ setRequestLocale: setRequestLocaleMock }));
// The page's subtree reaches next-intl's CLIENT navigation factory, whose ESM imports the bare
// specifier "next/navigation" and fails to resolve under vitest ("Did you mean next/navigation.js").
// Stubbing "next/navigation" above does not prevent that: the mock serves OUR import graph, while
// next-intl resolves its own through Node. Stubbing the app wrapper stops the factory loading at all,
// which is why 88 other suites in this repo stub this module rather than the Next one.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/swap",
  redirect: vi.fn(),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import SwapPage from "./page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("SwapPage (POO-1046)", () => {
  it("[R1] 404s with the flag off — the dark-launch baseline", async () => {
    await expect(SwapPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("[R5] renders with the flag on, and sets the request locale for static rendering", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_SWAP_SCREEN", "true");

    const tree = await SwapPage({ params: Promise.resolve({ locale: "pt-BR" }) });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(setRequestLocaleMock).toHaveBeenCalledWith("pt-BR");
    expect(tree).toBeTruthy();
  });
});
