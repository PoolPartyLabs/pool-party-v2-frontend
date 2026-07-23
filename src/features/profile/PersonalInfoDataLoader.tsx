/**
 * @id PP-PROF-SCR-002 (POO-233, POO-426)
 * @name Personal-info data loader
 * @implements-rules-version v1
 *
 * Real-mode client boundary for the Personal-info editor. It injects the signed-write save function
 * (`useUpdateProfile`) and the avatar upload (`useUploadAvatar`, POO-580) into the presentational
 * `PersonalInfoScreen` so the screen stays untouched while real-mode edits sign + PATCH `/users/me`.
 * POO-707 [R2]: the avatar upload is session-authorized (the SIWE JWT), so it needs NO wallet signature;
 * the ONE signature is the deferred PATCH at Save. Mirrors `ExplorePagedLoader`: used only when
 * `isMockMode` is false (mock mode renders `PersonalInfoScreen` directly, with no upload fn and its
 * default onSave — the crop stays a session-local preview).
 */
"use client";

import type { ProfileUser } from "@/lib/schemas";
import { useUpdateProfile } from "./hooks/useUpdateProfile";
import { useUploadAvatar } from "./hooks/useUploadAvatar";
import { PersonalInfoScreen } from "./PersonalInfoScreen";

/** Public props for {@link PersonalInfoDataLoader}. */
export interface PersonalInfoDataLoaderProps {
  /** The signed-in user, read server-side. */
  user: ProfileUser;
}

/** Renders the Personal-info editor wired to the real signed-write save + avatar upload. */
export function PersonalInfoDataLoader({ user }: PersonalInfoDataLoaderProps) {
  const save = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  return <PersonalInfoScreen user={user} onSave={save} onUploadAvatar={uploadAvatar} />;
}
