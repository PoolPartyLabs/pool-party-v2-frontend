import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function postReport(body: string): NextRequest {
  return new NextRequest("http://localhost/api/csp-report", { method: "POST", body });
}

describe("POST /api/csp-report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a well-formed report with 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(
      postReport(JSON.stringify({ "csp-report": { "violated-directive": "script-src" } })),
    );

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rejects an oversized body with 413", async () => {
    const res = await POST(postReport("x".repeat(9000)));

    expect(res.status).toBe(413);
  });

  it("ignores a malformed body with 204 and never throws", async () => {
    const res = await POST(postReport("{ not json"));

    expect(res.status).toBe(204);
  });

  it("logs only known fields, never the raw attacker-controlled body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const marker = "attacker-marker-should-not-be-logged";
    await POST(
      postReport(
        JSON.stringify({ "csp-report": { "blocked-uri": "https://evil/x", note: marker } }),
      ),
    );

    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
