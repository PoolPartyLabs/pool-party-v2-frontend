/**
 * @id PP-TOOLS-API-001
 * @name hookrisk scan endpoint, tests
 * @implements-rules-version v1
 * @analytics-events none
 *
 * Behavior under test:
 *   [R17] a malformed address or an unsupported chain is refused BEFORE any work starts, so a typo
 *         never costs a compile.
 *   [R18] a start returns 202 with a job id while work runs, and 200 when the answer was cached.
 *   [R19] a second start for a hook already being scanned joins the running job. That is the rate
 *         limit, and it is why Analyze can be pressed twice without queueing two compiles.
 *   [R20] polling an unknown id says so rather than reporting a scan that is not happening.
 *
 * The job layer is mocked: this file asserts the HTTP contract, and nothing here shells out.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startScan = vi.fn();
const getJob = vi.fn();

vi.mock("@/lib/tools/hookrisk/jobs", () => ({
  startScan: (...args: unknown[]) => startScan(...args),
  getJob: (...args: unknown[]) => getJob(...args),
}));

import { GET, POST } from "./route";

const ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const JOB_ID = "a".repeat(64);

function post(body: unknown): NextRequest {
  return new NextRequest("https://app.test/api/tools/hookrisk", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  startScan.mockReset();
  getJob.mockReset();
});

describe("POST validation [R17]", () => {
  it("refuses a body that is not JSON", async () => {
    const response = await POST(post("not json"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "BAD_BODY" });
    expect(startScan).not.toHaveBeenCalled();
  });

  it("refuses an unsupported chain", async () => {
    const response = await POST(post({ chainId: 10, address: ADDRESS }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "UNSUPPORTED_CHAIN" });
    expect(startScan).not.toHaveBeenCalled();
  });

  it("refuses a malformed address", async () => {
    const response = await POST(post({ chainId: 1, address: "0xnothex" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ADDRESS" });
    expect(startScan).not.toHaveBeenCalled();
  });

  it("checksums a lowercased address before handing it on", async () => {
    startScan.mockResolvedValue({ jobId: JOB_ID, status: "queued", startedAt: 1, reused: false });
    await POST(post({ chainId: 130, address: ADDRESS.toLowerCase() }));
    expect(startScan).toHaveBeenCalledWith({ chainId: 130, address: ADDRESS });
  });
});

describe("POST start [R18][R19]", () => {
  it("returns 202 and the job id while a scan runs", async () => {
    startScan.mockResolvedValue({ jobId: JOB_ID, status: "queued", startedAt: 1, reused: false });
    const response = await POST(post({ chainId: 1, address: ADDRESS }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ jobId: JOB_ID, status: "queued" });
  });

  it("returns 200 with the report when it was already cached", async () => {
    startScan.mockResolvedValue({
      jobId: JOB_ID,
      status: "done",
      report: "# HOOK RISK",
      cached: true,
      startedAt: 1,
      finishedAt: 2,
      reused: false,
    });
    const response = await POST(post({ chainId: 1, address: ADDRESS }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ report: "# HOOK RISK", cached: true });
  });

  it("reports a joined job as reused rather than starting a second one [R19]", async () => {
    startScan.mockResolvedValue({
      jobId: JOB_ID,
      status: "scanning",
      startedAt: 1,
      reused: true,
    });
    const response = await POST(post({ chainId: 1, address: ADDRESS }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ reused: true, status: "scanning" });
    expect(startScan).toHaveBeenCalledTimes(1);
  });
});

describe("GET poll [R20]", () => {
  function get(query: string): NextRequest {
    return new NextRequest(`https://app.test/api/tools/hookrisk${query}`);
  }

  it("refuses a missing or malformed job id", async () => {
    for (const query of ["", "?jobId=", "?jobId=nope"]) {
      const response = await GET(get(query));
      expect(response.status, query).toBe(400);
    }
    expect(getJob).not.toHaveBeenCalled();
  });

  it("reports an unknown job as gone rather than as still running", async () => {
    getJob.mockReturnValue(null);
    const response = await GET(get(`?jobId=${JOB_ID}`));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "JOB_UNKNOWN" });
  });

  it("returns the snapshot of a known job", async () => {
    getJob.mockReturnValue({ jobId: JOB_ID, status: "building", startedAt: 1 });
    const response = await GET(get(`?jobId=${JOB_ID}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "building" });
  });

  it("returns a failure with its code, so the screen can report the right thing", async () => {
    getJob.mockReturnValue({
      jobId: JOB_ID,
      status: "failed",
      startedAt: 1,
      finishedAt: 2,
      error: { code: "NOT_VERIFIED", message: "no verified source" },
    });
    const response = await GET(get(`?jobId=${JOB_ID}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      error: { code: "NOT_VERIFIED" },
    });
  });
});
