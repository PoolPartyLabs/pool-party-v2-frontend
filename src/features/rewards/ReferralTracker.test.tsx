/**
 * @id PP-REW-CMP-019 (POO-718)
 * @name ReferralTracker tests
 * @implements-rules-version v1
 *
 * The capture + opportunistic-apply orchestrator. Rules exercised:
 * - [R1] read ?ref=, validate the shape (ignore malformed), [R2] first-touch persist + strip ?ref=.
 * - [R4] apply only once a session exists (any login method), at most once per pending code.
 * - [R8] on "applied", clear the pending code and refresh so the referred-by read re-runs.
 * - [R2] a signed-out landing persists the code and does NOT apply (waits for the next session).
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_REFERRAL_COOKIE,
  readPendingReferralCode,
} from "@/lib/rewards/pendingReferralCode";

const state = vi.hoisted(() => ({ ref: null as string | null, signedIn: false }));
const mocks = vi.hoisted(() => ({ apply: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.ref ? `ref=${state.ref}` : ""),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: state.signedIn, status: "idle", error: null }),
}));
vi.mock("./actions", () => ({ applyReferralCodeAction: (...a: unknown[]) => mocks.apply(...a) }));

import { __resetReferralTrackerForTests, ReferralTracker } from "./ReferralTracker";

function wipeCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom test setup.
  document.cookie = `${PENDING_REFERRAL_COOKIE}=; Max-Age=0; path=/`;
}

/** Point window.location at a ?ref= landing so the URL-strip has something to remove. */
function landAt(url: string) {
  window.history.replaceState(null, "", url);
}

describe("ReferralTracker", () => {
  beforeEach(() => {
    wipeCookie();
    __resetReferralTrackerForTests();
    state.ref = null;
    state.signedIn = false;
    mocks.apply.mockReset();
    mocks.refresh.mockReset();
    mocks.apply.mockResolvedValue("applied");
    landAt("/en/home");
  });

  // @rule R2 (signed-out landing: persist the code, strip ?ref=, do NOT apply)
  it("captures + persists the code and strips ?ref= without applying while signed out", async () => {
    state.ref = "ABC123";
    landAt("/en/home?ref=ABC123&x=1");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(<ReferralTracker />);

    await waitFor(() => expect(readPendingReferralCode()).toBe("ABC123"));
    // ?ref= gone, unrelated params kept.
    const stripped = replaceState.mock.calls.at(-1)?.[2] as string;
    expect(stripped).not.toContain("ref=");
    expect(stripped).toContain("x=1");
    expect(mocks.apply).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  // @rule R1 (a malformed ?ref= is ignored: nothing persisted, no apply). POO-853 R2: the floor is now
  // 3 chars (legacy short codes count), so "ab" (2 chars) is the below-floor malformed case.
  it("ignores a malformed ?ref= code", async () => {
    state.ref = "ab"; // too short (below the 3-char backend floor)
    landAt("/en/home?ref=ab");
    render(<ReferralTracker />);
    await waitFor(() => expect(mocks.apply).not.toHaveBeenCalled());
    expect(readPendingReferralCode()).toBeNull();
  });

  // @rule R4 (apply fires once a session exists, exactly once per pending code)
  it("applies the pending code once a session exists, exactly once", async () => {
    state.ref = "ABC123";
    landAt("/en/home?ref=ABC123");
    const view = render(<ReferralTracker />);
    await waitFor(() => expect(readPendingReferralCode()).toBe("ABC123"));
    expect(mocks.apply).not.toHaveBeenCalled();

    state.signedIn = true;
    view.rerender(<ReferralTracker />);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    // A further render does not re-fire (once per code).
    view.rerender(<ReferralTracker />);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
  });

  // @rule R8 (on applied: clear the pending code + refresh)
  it("clears the pending code and refreshes on a successful apply", async () => {
    state.ref = "ABC123";
    state.signedIn = true;
    landAt("/en/home?ref=ABC123");
    render(<ReferralTracker />);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readPendingReferralCode()).toBeNull());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // @rule R7 (a soft, non-applied outcome does not refresh)
  it("does not refresh when the outcome is not an attach", async () => {
    mocks.apply.mockResolvedValue("not-applicable");
    state.ref = "ABC123";
    state.signedIn = true;
    landAt("/en/home?ref=ABC123");
    render(<ReferralTracker />);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // @rule R4 (a prior visit's cookie is applied on the next signed-in load, even with no ?ref=)
  it("applies a previously-persisted code with no ?ref= present", async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom test setup — seed a prior visit's cookie.
    document.cookie = `${PENDING_REFERRAL_COOKIE}=OLD123; path=/`;
    state.ref = null;
    state.signedIn = true;
    render(<ReferralTracker />);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
  });

  // @rule R4 (a `no-session` outcome keeps the code pending and re-allows a retry on the next load —
  // the client believes it is signed in but the server could not derive a wallet)
  it("keeps the code pending and retries on the next load when the server returns no-session", async () => {
    mocks.apply.mockResolvedValueOnce("no-session"); // then falls back to "applied" (beforeEach default)
    state.ref = "ABC123";
    state.signedIn = true;
    landAt("/en/home?ref=ABC123");
    const view = render(<ReferralTracker />);

    // First attempt resolves no-session: the code stays pending (not cleared) and nothing refreshes.
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readPendingReferralCode()).toBe("ABC123"));
    expect(mocks.refresh).not.toHaveBeenCalled();

    // The next authenticated load (fresh mount) retries — the code was re-allowed, not stuck.
    view.unmount();
    render(<ReferralTracker />);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readPendingReferralCode()).toBeNull());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
