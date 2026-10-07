/**
 * @id PP-CORE-LIB-123
 * @name fetchExperimentAccess tests
 * @implements-rules-version v1 (POO-2281)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSessionToken: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/auth/session", () => ({ getSessionToken: mocks.getSessionToken }));

import { __resetDevOverridesForTests, setOverride } from "@/lib/features/devOverrides";
import { deniedExperimentAccess, experimentAccessSchema } from "./access";
import { loadSolanaPreviewAccess } from "./fetchExperimentAccess";

const now = new Date("2026-10-07T13:00:00Z");
const grant = {
  schemaVersion: 1,
  experiment: "solana-preview",
  status: "allowed",
  capabilities: ["preview"],
  expiresAt: "2026-10-07T13:01:00Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
  vi.stubEnv("NEXT_PUBLIC_FEATURE_SOLANA_SPOKE", "on");
  mocks.apiFetch.mockReset().mockResolvedValue(grant);
  mocks.getSessionToken.mockReset().mockResolvedValue("session-a");
  __resetDevOverridesForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetDevOverridesForTests();
});

describe("server experiment access", () => {
  // @rule R1: server gates are independent from browser QA overrides.
  it.each([
    "NEXT_PUBLIC_FEATURE_FUND_CONTRACTS",
    "NEXT_PUBLIC_FEATURE_SOLANA_SPOKE",
  ])("denies without reading identity or API when %s is off", async (flag) => {
    vi.stubEnv(flag, "off");
    setOverride("fundContracts", true);
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
    expect(mocks.getSessionToken).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R3: test fixtures must never grant real access.
  it("denies in mock mode without reading a session", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "true");
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
    expect(mocks.getSessionToken).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R3: a guest has no experiment permission.
  it.each([null, ""])("denies a missing session %j without an API request", async (token) => {
    mocks.getSessionToken.mockResolvedValue(token);
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R2: the backend verifies each current session, with no frontend personal allowlist.
  it("supports independent approved sessions and forwards no client wallet", async () => {
    const accessA = await loadSolanaPreviewAccess();
    mocks.getSessionToken.mockResolvedValue("session-b");
    const accessB = await loadSolanaPreviewAccess();
    expect(accessA).toEqual(grant);
    expect(accessB).toEqual(grant);
    expect(mocks.apiFetch.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual([
      "Bearer session-a",
      "Bearer session-b",
    ]);
    expect(mocks.apiFetch).toHaveBeenCalledWith("experiments/solana-preview/access", {
      schema: experimentAccessSchema,
      headers: { Authorization: "Bearer session-b" },
      revalidate: 0,
    });
  });

  // @rule R4: only capability metadata is returned, not the Bearer or member list.
  it("does not return token, wallet, profile or cohort fields", async () => {
    const access = await loadSolanaPreviewAccess();
    expect(Object.keys(access).sort()).toEqual([
      "capabilities",
      "experiment",
      "expiresAt",
      "schemaVersion",
      "status",
    ]);
    expect(JSON.stringify(access)).not.toContain("session-a");
  });

  // @rule R3: contract failures and denial do not reuse an earlier allowed result.
  it.each([
    null,
    {},
    { ...grant, schemaVersion: 2 },
    deniedExperimentAccess(),
  ])("denies an unavailable or rejected response: %j", async (response) => {
    expect((await loadSolanaPreviewAccess()).status).toBe("allowed");
    mocks.apiFetch.mockResolvedValue(response);
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
  });

  // @rule R3: outage, rejected session and missing endpoint all fail closed.
  it.each([
    "404",
    "401",
    "403",
    "429",
    "503",
    "timeout",
    "parse error",
  ])("denies an upstream %s without propagating sensitive errors", async (code) => {
    mocks.apiFetch.mockRejectedValue(new Error(code));
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  // @rule R3: the result must still be unexpired when the API read finishes.
  it("denies a grant that expires during the request", async () => {
    mocks.apiFetch.mockImplementation(async () => {
      vi.setSystemTime(new Date(grant.expiresAt));
      return grant;
    });
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
  });

  // @rule R3: a changed or signed-out session cannot inherit the previous account's read.
  it.each([
    null,
    "session-b",
  ])("denies when the session becomes %j during the request", async (nextToken) => {
    mocks.getSessionToken.mockResolvedValueOnce("session-a").mockResolvedValue(nextToken);
    expect(await loadSolanaPreviewAccess()).toEqual(deniedExperimentAccess());
  });
});
