/**
 * @id PP-CORE (INT-DEPLOY)
 * @name Health check
 *
 * Liveness probe for the orchestrator (docker-compose healthcheck, load balancer). Returns 200 as
 * long as the Next server is serving. Intentionally SHALLOW: it does not call pool-party-api, so a
 * transient backend blip can't mark the web tier unhealthy and trigger a restart loop. Mirrors the
 * v1 interface's `/api/healthcheck` (`{ status: "ok" }`).
 */
import { NextResponse } from "next/server";

// Always evaluate at request time so the probe reflects the live server (never a cached 200).
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok", uptime: process.uptime() }, { status: 200 });
}
