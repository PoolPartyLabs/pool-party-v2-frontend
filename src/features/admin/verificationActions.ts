/**
 * @id PP-ADM-AUTH-001
 * @name admin verification server actions
 * @implements-rules-version v1
 *
 * Server actions for the Admin Console manager-verification queue (POO-587). Each resolves the admin
 * session server-side and enforces the required capability before mutating; the reviewer identity is
 * the session email, never a client-supplied value. Reads/writes go through the verification service
 * (mock today; real = pool-party-api via apiFetch, never the DB).
 */
"use server";

import { assertAdminCanLive } from "@/lib/admin/authz";
import { type AdminSession, resolveAdminSession } from "@/lib/admin/session";
import { verificationService } from "@/lib/services";

async function requireAdminSession(): Promise<AdminSession> {
  const session = await resolveAdminSession();
  if (!session) throw new Error("admin: not signed in");
  return session;
}

/** Approve a pending manager verification (sets `managerVerification` to `valid` — the sole badge source since POO-809). */
export async function approveVerificationAction(handle: string): Promise<void> {
  const session = await requireAdminSession();
  await assertAdminCanLive(session, "verification.approve");
  await verificationService.approve(handle, session.email);
}

/** Reject a pending manager verification (admin/master only). */
export async function rejectVerificationAction(handle: string, reason?: string): Promise<void> {
  const session = await requireAdminSession();
  await assertAdminCanLive(session, "verification.reject");
  await verificationService.reject(handle, session.email, reason);
}
