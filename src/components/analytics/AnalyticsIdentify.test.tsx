/**
 * @id PP-CORE-LIB-010
 * @name AnalyticsIdentify.test
 * Behavior (POO-164): with a connected wallet AND granted consent the component resolves the
 * server hash and fills the store; denied/unknown consent or no wallet clears it; a `pp:consent`
 * signal (banner choice) re-syncs without a reload. Mock mode stays unidentified by design.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeConsent } from "@/lib/analytics/consent";
import { getAnalyticsUserId, setAnalyticsUserId } from "@/lib/analytics/userId";
import { renderWithProviders, waitFor } from "../../../tests/utils/renderWithProviders";
import { AnalyticsIdentify } from "./AnalyticsIdentify";

const HASH = "b".repeat(64);
const ADDRESS = "0x2222222222222222222222222222222222222222";

// Real-mode path: pretend mock mode is off and a wagmi account is connected.
vi.mock("@/lib/services", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services")>();
  return { ...original, isMockMode: false };
});
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockConnectedAddress }),
}));

let mockConnectedAddress: string | undefined;

function clearConsentCookie() {
  document.cookie = "pp_consent=; Path=/; Max-Age=0";
}

beforeEach(() => {
  mockConnectedAddress = undefined;
  setAnalyticsUserId(null);
  clearConsentCookie();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: HASH }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearConsentCookie();
});

describe("AnalyticsIdentify", () => {
  it("resolves and stores the user id when wallet is connected and consent granted", async () => {
    mockConnectedAddress = ADDRESS;
    writeConsent("granted");
    renderWithProviders(<AnalyticsIdentify />);
    await waitFor(() => expect(getAnalyticsUserId()).toBe(HASH));
  });

  it("stays unidentified without consent and clears on a denied banner choice", async () => {
    mockConnectedAddress = ADDRESS;
    renderWithProviders(<AnalyticsIdentify />);
    // Unknown consent → nothing resolved.
    expect(getAnalyticsUserId()).toBeNull();
    // Granting via the banner signal identifies without a reload…
    writeConsent("granted");
    await waitFor(() => expect(getAnalyticsUserId()).toBe(HASH));
    // …and withdrawing clears the id again (GDPR-style revocation).
    writeConsent("denied");
    await waitFor(() => expect(getAnalyticsUserId()).toBeNull());
  });

  it("stays unidentified when no wallet is connected, even with consent", async () => {
    mockConnectedAddress = undefined;
    writeConsent("granted");
    renderWithProviders(<AnalyticsIdentify />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getAnalyticsUserId()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
