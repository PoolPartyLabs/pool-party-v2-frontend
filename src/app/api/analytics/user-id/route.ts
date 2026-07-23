/**
 * @id PP-CORE-LIB-010
 * @name analytics user-id endpoint
 * @implements-rules-version v1
 *
 * Server seam for the pseudonymous analytics `user_id` (POO-164): the client posts the connected
 * wallet address (first-party only — this never goes to analytics) and gets back the HMAC-SHA-256
 * hash keyed with the server-held `PP_ANALYTICS_USER_ID_SECRET`. The raw address is validated,
 * never logged and never stored. With the secret unset the endpoint degrades gracefully to
 * `{ userId: null }` so analytics simply runs unidentified (no crash).
 *
 * PP-SECURITY [R2]: only the hash ever reaches the dataLayer; [R4] consent gating happens
 * client-side in `useAnalytics`/`sanitizeParams` — this endpoint only derives the id.
 *
 * PP-SECURITY (POO-352): this is a first-party HMAC hash oracle (post an address, get its pseudonym).
 * Block cross-site browser abuse with the `Sec-Fetch-Site` signal (set by the browser, proxy-safe): a
 * same-origin fetch sends "same-origin", a malicious site's fetch sends "cross-site"/"same-site". We
 * reject only when the header is present and not same-origin; an absent header (non-browser/legacy)
 * falls through, and rate-limiting those is a backend/infra follow-up (POO-352).
 */
import { type NextRequest, NextResponse } from "next/server";
import { hashWalletAddress } from "@/lib/analytics/hashWalletAddress";

const MAX_BODY_BYTES = 1_024;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    const parsed: unknown = JSON.parse(body);
    const address =
      parsed && typeof parsed === "object" && "address" in parsed
        ? (parsed as Record<string, unknown>).address
        : undefined;
    if (typeof address !== "string" || !EVM_ADDRESS.test(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }
    const secret = process.env.PP_ANALYTICS_USER_ID_SECRET;
    if (!secret) {
      // PP-NOTE: secret not provisioned (e.g. local dev) → identified analytics stays off.
      return NextResponse.json({ userId: null }, { headers: { "Cache-Control": "no-store" } });
    }
    const userId = await hashWalletAddress(address as `0x${string}`, secret);
    return NextResponse.json({ userId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
}
