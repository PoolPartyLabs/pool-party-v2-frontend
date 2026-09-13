/**
 * @id PP-TOOLS-API-001
 * @name hookrisk scan endpoint
 * @implements-rules-version v1
 * @analytics-events none (PP-TOOLS-CMP-001 emits the funnel; a route handler has no consent context)
 *
 * `POST` starts a scan, `GET` polls one.
 *
 * Node runtime, not edge, and that is not a preference: the work is a child process compiling
 * Solidity on a local filesystem.
 *
 * No wallet session is required. The endpoint reads a public block explorer and analyses a public
 * contract, so gating it behind SIWE would protect nothing while making the demo harder to show.
 * What it does have is the single meaningful limit for work this expensive: one running job per
 * `(chainId, address)`. A second start for a hook already being scanned joins that job instead of
 * queueing another compile, so a user hammering Analyze costs one scan, not N.
 */
import { type NextRequest, NextResponse } from "next/server";
import { isSupportedChain } from "@/lib/tools/hookrisk/explorer";
import { getJob, startScan } from "@/lib/tools/hookrisk/jobs";
import { normalizeAddress } from "@/lib/tools/hookrisk/paths";

export const runtime = "nodejs";
/** A scan mutates the filesystem and reads a live explorer; nothing here may be prerendered. */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

function badRequest(code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status: 400 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let parsed: unknown;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { code: "BODY_TOO_LARGE", message: "Body too large." },
        { status: 413 },
      );
    }
    parsed = JSON.parse(body);
  } catch {
    return badRequest("BAD_BODY", "Expected a JSON body with a chainId and an address.");
  }

  const input = (parsed ?? {}) as Record<string, unknown>;
  const chainId = Number(input.chainId);
  if (!Number.isInteger(chainId) || !isSupportedChain(chainId)) {
    return badRequest("UNSUPPORTED_CHAIN", "That chain is not one of the chains this tool reads.");
  }

  const address = typeof input.address === "string" ? normalizeAddress(input.address) : null;
  if (!address) {
    return badRequest("INVALID_ADDRESS", "That is not a valid contract address.");
  }

  const result = await startScan({ chainId, address });
  // 200 when the answer is already in hand, 202 when work is (or already was) under way.
  return NextResponse.json(result, { status: result.status === "done" ? 200 : 202 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[0-9a-f]{64}$/.test(jobId)) {
    return badRequest("BAD_JOB_ID", "Missing or malformed jobId.");
  }
  const job = getJob(jobId);
  if (!job) {
    // The registry is per process, so an unknown id means a restart or another replica. Saying
    // "gone" is honest; pretending it is still queued would leave the page polling forever.
    return NextResponse.json(
      { code: "JOB_UNKNOWN", message: "This scan is no longer tracked. Run it again." },
      { status: 404 },
    );
  }
  return NextResponse.json(job, { status: 200 });
}
