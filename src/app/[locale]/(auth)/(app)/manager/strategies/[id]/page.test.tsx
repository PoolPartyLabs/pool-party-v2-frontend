/**
 * @id PP-MGR-SCR-005 (POO-519)
 * @name ManagerPositionPage.test
 * @implements-rules-version v1
 * Route test for /manager/strategies/[id]: the page no longer renders the orphaned
 * LivePositionScreen and instead issues a locale-preserving redirect to the console manage view
 * (/manager?manage=<id>) [R1].
 */
import { describe, expect, it, vi } from "vitest";
import ManagerPositionPage from "./page";

const { redirectMock, setRequestLocaleMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  setRequestLocaleMock: vi.fn(),
}));

// The i18n-aware redirect (from @/i18n/navigation) is what preserves the locale prefix.
vi.mock("@/i18n/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next-intl/server", () => ({
  setRequestLocale: setRequestLocaleMock,
}));

describe("ManagerPositionPage (POO-519)", () => {
  it("[R1] redirects to the console manage view for the strategy, preserving the locale", async () => {
    await ManagerPositionPage({
      params: Promise.resolve({ locale: "pt-BR", id: "strategy-42" }),
    });

    expect(setRequestLocaleMock).toHaveBeenCalledWith("pt-BR");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith({
      href: { pathname: "/manager", query: { manage: "strategy-42" } },
      locale: "pt-BR",
    });
  });

  it("[R1] targets the manage deep link for the requested id", async () => {
    await ManagerPositionPage({
      params: Promise.resolve({ locale: "en", id: "other-id" }),
    });

    expect(redirectMock).toHaveBeenCalledWith({
      href: { pathname: "/manager", query: { manage: "other-id" } },
      locale: "en",
    });
  });
});
