/**
 * @id PP-CORE (SETUP-015 / POO-81)
 * @name CSP report collector
 *
 * Receives Content-Security-Policy-Report-Only violations while the policy is in observe mode.
 * Hardened against abuse: body-size cap, JSON + shape validation, and only known fields (length
 * capped) are logged so an attacker-controlled body cannot inject into or flood the log store.
 * PP-INTEGRATION-POINT: forward to a real sink (error pipeline / log store) and add edge/proxy rate
 * limiting before promoting the CSP from Report-Only to enforce.
 */
import { type NextRequest, NextResponse } from "next/server";

const MAX_BODY_BYTES = 8_192;
const MAX_FIELD_CHARS = 256;

/** Coerce an unknown report field to a short, log-safe string (or undefined). */
function clip(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_CHARS) : undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    const parsed: unknown = JSON.parse(body);
    const report =
      parsed && typeof parsed === "object" && "csp-report" in parsed
        ? (parsed as Record<string, unknown>)["csp-report"]
        : parsed;
    if (report && typeof report === "object") {
      const fields = report as Record<string, unknown>;
      // PP-MOCK: log only known, length-capped fields (never the raw body) until a real sink lands.
      console.warn("[csp-report]", {
        documentUri: clip(fields["document-uri"]),
        violatedDirective: clip(fields["violated-directive"]),
        blockedUri: clip(fields["blocked-uri"]),
      });
    }
  } catch {
    // Never throw from a reporting endpoint; ignore malformed or oversized bodies.
  }
  return new NextResponse(null, { status: 204 });
}
