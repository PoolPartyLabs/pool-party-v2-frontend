/**
 * @id PP-ADM-AUTH-001
 * @name admin moderation server actions
 * @implements-rules-version v1
 *
 * Server actions for the Admin Console image-moderation queue (POO-590). Each resolves the admin
 * session server-side and enforces the required capability before mutating; the reviewer identity is
 * the session email. Reads/writes go through the moderation service (mock today; real = pool-party-api
 * via apiFetch, never the DB).
 */
"use server";

import { assertAdminCanLive } from "@/lib/admin/authz";
import { type AdminSession, resolveAdminSession } from "@/lib/admin/session";
import { moderationService } from "@/lib/services";

async function requireAdminSession(): Promise<AdminSession> {
  const session = await resolveAdminSession();
  if (!session) throw new Error("admin: not signed in");
  return session;
}

/** Approve (reviewed-keep) a pending image. */
export async function approveImageAction(id: string): Promise<void> {
  const session = await requireAdminSession();
  await assertAdminCanLive(session, "image.approve");
  await moderationService.approve(id, session.email);
}

/** Remove (soft-hide) a pending image, with an optional reason. */
export async function removeImageAction(id: string, reason?: string): Promise<void> {
  const session = await requireAdminSession();
  await assertAdminCanLive(session, "image.remove");
  await moderationService.remove(id, session.email, reason);
}
